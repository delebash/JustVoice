# SPDX-License-Identifier: MIT
"""Host-side voice blending — file math, no engine process involved.

Managed engines run as subprocess procs the registry never holds, so a
python-call into an adapter could never reach them for blending. It also
never needed to: a Kokoro voice is a (510, 1, 256) float32 style array
sitting in the installed variant's name-keyed voices file (np.load-able),
and a blend is the elementwise weighted average

    blend[i] = Σ(wⱼ · voiceⱼ[i]) / Σwⱼ

— the canonical Kokoro mix (slerp/lerp retired 2026-08-19). Creating a
blend therefore needs only files on disk; the engine can be unloaded.
Only *hearing* a blend needs the engine, and that rides the normal synth
path as ``SynthRequest.voice_vector``.

Per-engine dispatch is explicit because exactly one engine blends today.
Pocket TTS is the next candidate — it exports reloadable voice embeddings.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable


# The one source id that is not a voice. Extrapolate is `mean + k·(v − mean)`,
# which rearranges to `k·v + (1−k)·mean` — an ordinary weighted combination
# whose weights sum to 1, so the existing blend path runs it unchanged once
# the centroid is resolvable as a source. That is the whole reason this
# constant exists instead of a fourth code path (2026-08-21).
MEAN_SOURCE = "__pack_mean__"


def supports(engine_id: str) -> bool:
    """Which engines can blend. Mirrors capability_details' per-engine
    `supports_voice_blending` — keep the two in step."""
    return engine_id == "kokoro"


def preset_language(engine_id: str, voice_id: str) -> str | None:
    """The catalog language of a preset voice id, if this id is a preset."""
    if engine_id != "kokoro":
        return None
    from .kokoro.voices import VOICES

    for vid, _name, lang, _gender in VOICES:
        if vid == voice_id:
            return lang
    return None


def blend(
    engine_id: str,
    source_ids: list[str],
    weights: list[float],
    *,
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
    normalize: bool = True,
) -> list[float]:
    """Weighted-combine the source voices' style vectors into one, flat.

    `resolve_stored` maps a stored-voice id (an earlier blend) to its saved
    vector, so blends of blends work. Raises LookupError for a missing
    voice or an uninstalled engine, ValueError for shape mismatches.

    `normalize` divides by Σw, which is right for a MIX — the weights are
    shares and the result must stay on the voices' own scale. It is wrong
    for the vector-analogy strategy (A + B − C), where magnitude is the
    point and dividing silently shrinks the answer: at weights 1, 1, −1 the
    sum is 1 and the two agree by accident, but at 2, 1, −1 normalizing
    halves everything (2026-08-21 ruling).

    MEAN_SOURCE may appear in `source_ids` — see its docstring.
    """
    if engine_id != "kokoro":
        raise NotImplementedError(f"engine '{engine_id}' has no blend support")
    return _kokoro_blend(source_ids, weights, data_dir, resolve_stored, normalize)


def recombine(
    engine_id: str,
    segments: "list[tuple[str, float, float]]",
    *,
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
) -> list[float]:
    """Assemble one voice from CONTIGUOUS SLICES of several voices' vectors.

    Each segment is (voice_id, start, end) with start/end as fractions of the
    style vector's feature axis. This is not a mix: no value is averaged with
    another, each output feature is taken whole from exactly one source.

    Why the feature axis matters, and why this is not a toy: Kokoro is
    StyleTTS2-based, and StyleTTS2 uses the two halves of its 256-wide
    reference vector for different jobs — `ref_s[:, :128]` conditions the
    DECODER (timbre) and `ref_s[:, 128:]` conditions the prosody predictor
    (verified in StyleTTS2's own Demo/Inference_LibriTTS.ipynb, 2026-08-21).
    So 0.0-0.5 from one voice and 0.5-1.0 from another is one voice's timbre
    speaking with another's prosody.

    The slice therefore runs along the LAST axis of the pack's (510, 1, 256)
    array, per row. Slicing the flattened 130,560-float array instead would
    cut along the phoneme-count axis (kokoro-onnx picks row n-1 for an
    n-token utterance), i.e. short utterances in one voice and long ones in
    another — which is nothing anyone asked for.

    Uncovered features stay zero, and overlapping segments resolve
    last-wins, so the caller's ordering is the caller's business.
    """
    if engine_id != "kokoro":
        raise NotImplementedError(f"engine '{engine_id}' cannot recombine")
    return _kokoro_recombine(segments, data_dir, resolve_stored)


def blend_language(
    engine_id: str,
    source_ids: list[str],
    *,
    stored_language: Callable[[str], "str | None"],
    default: str,
) -> str:
    """The language a mix speaks: unanimous across its sources, else the
    configured default.

    THE one rule behind both doors (2026-08-21). It used to live only in the
    save path, while the pre-save audition sent a hardcoded "en-US" — so a
    mix of two Mandarin presets SAVED as zh but AUDITIONED as English, and
    Kokoro phonemized Chinese text with English rules. The engine cannot
    rescue this on its own: it falls back to the voice's catalog language,
    and a blend renders from a raw vector with no voice id to look up.

    MEAN_SOURCE is skipped — the pack centroid is every language at once and
    would make every extrapolation ambiguous.
    """
    langs: set[str] = set()
    for vid in source_ids:
        if vid == MEAN_SOURCE:
            continue
        lang = stored_language(vid) or preset_language(engine_id, vid)
        if lang:
            langs.add(lang)
    return next(iter(langs)) if len(langs) == 1 else default


def pack_mean(engine_id: str, *, data_dir: Path) -> list[float]:
    """The centroid of every preset voice in the installed pack, flat.

    This is the "average voice" the Extrapolate strategy pushes away from:
    `mean + k·(voice − mean)`. Exposed because a caller cannot compute it —
    the individual vectors never leave this module.
    """
    if engine_id != "kokoro":
        raise NotImplementedError(f"engine '{engine_id}' has no voice pack")
    return _kokoro_pack_mean(data_dir).ravel().astype("float32").tolist()


# ── Kokoro ───────────────────────────────────────────────────────────────


def _kokoro_voices_file(data_dir: Path) -> Path:
    """The installed variant's voices file. No fetching — blending never
    triggers a download; the caller surfaces 'install kokoro first'."""
    from .. import speech_cache
    from .kokoro import manifest as kokoro_manifest

    for variant in kokoro_manifest.VARIANTS:
        vid = variant["id"]
        if speech_cache.variant_on_disk(data_dir, "kokoro", vid):
            d = Path(speech_cache.variant_dir(data_dir, "kokoro", vid))
            hits = sorted(d.rglob("voices*.bin")) + sorted(d.rglob("voices*.npz"))
            if hits:
                return hits[0]
    raise LookupError("kokoro is not installed — download it in Engines first")


def _kokoro_pack(data_dir: Path):
    """The loaded voices pack + its name set. One door, because every
    strategy needs it and the failure mode below is worth stating once."""
    import numpy as np

    voices_file = _kokoro_voices_file(data_dir)
    try:
        pack = np.load(voices_file)
        return pack, set(pack.files)
    except Exception as e:
        # A pre-2026-08-19 sherpa-onnx directory holds a raw packed bin that
        # np.load cannot read — the runtime changed; the fix is a re-download.
        raise LookupError(
            f"kokoro voices file is from the retired sherpa-onnx runtime — "
            f"re-download Kokoro in Engines ({e})"
        )


def _kokoro_pack_shape(pack, names) -> tuple:
    """The pack's per-voice array shape, e.g. (510, 1, 256). Read from the
    pack rather than hardcoded — a future pack may size differently, and a
    wrong constant here would corrupt every recombine silently."""
    import numpy as np

    for n in names:
        return np.asarray(pack[n]).shape
    raise LookupError("kokoro voices file holds no voices")


def _kokoro_pack_mean(data_dir: Path):
    """Centroid over every preset in the pack, in PACK SHAPE."""
    import numpy as np

    pack, names = _kokoro_pack(data_dir)
    if not names:
        raise LookupError("kokoro voices file holds no voices")
    acc = None
    for n in names:
        v = np.asarray(pack[n], dtype=np.float32)
        acc = v.copy() if acc is None else acc + v
    return acc / float(len(names))


def _kokoro_vectors(
    source_ids: list[str],
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
    *,
    shaped: bool = False,
) -> "list":
    """Resolve ids → arrays. `shaped` keeps the pack's (510, 1, 256) form
    (recombine needs the feature axis); otherwise they come back flat, which
    is what a weighted average wants and what a stored blend already is."""
    import numpy as np

    pack, names = _kokoro_pack(data_dir)
    shape = _kokoro_pack_shape(pack, names) if shaped else None
    mean_cache = None

    out: list = []
    for vid in source_ids:
        if vid == MEAN_SOURCE:
            if mean_cache is None:
                mean_cache = _kokoro_pack_mean(data_dir)
            arr = mean_cache
        elif vid in names:
            arr = np.asarray(pack[vid], dtype=np.float32)
        else:
            stored = resolve_stored(vid)
            if stored is None:
                raise LookupError(
                    f"unknown source voice '{vid}' — not a kokoro preset or a stored blend"
                )
            arr = np.asarray(stored, dtype=np.float32)
        if shaped:
            # A stored blend arrives flat; put it back in pack shape so its
            # feature axis lines up with a preset's.
            if arr.shape != shape:
                if arr.size != int(np.prod(shape)):
                    raise ValueError(
                        f"voice '{vid}' has {arr.size} values; this pack's voices "
                        f"are {shape} — re-blend against the installed pack."
                    )
                arr = arr.reshape(shape)
        else:
            arr = arr.ravel()
        out.append(arr)

    sizes = {v.size for v in out}
    if len(sizes) != 1:
        raise ValueError(f"source voices have mismatched vector sizes: {sorted(sizes)}")
    return out


def _kokoro_blend(
    source_ids: list[str],
    weights: list[float],
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
    normalize: bool = True,
) -> list[float]:
    import numpy as np

    vecs = _kokoro_vectors(source_ids, data_dir, resolve_stored)

    denom = 1.0
    if normalize:
        denom = float(sum(weights))
        if denom == 0:
            raise ValueError("weights must sum to a non-zero value")

    out = np.zeros_like(vecs[0])
    for v, w in zip(vecs, weights):
        out += (w / denom) * v
    return out.astype(np.float32).tolist()


def _kokoro_recombine(
    segments: "list[tuple[str, float, float]]",
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
) -> list[float]:
    import numpy as np

    if not segments:
        raise ValueError("recombine needs at least one segment")

    ids = [s[0] for s in segments]
    vecs = _kokoro_vectors(ids, data_dir, resolve_stored, shaped=True)
    features = vecs[0].shape[-1]

    out = np.zeros_like(vecs[0])
    covered = np.zeros(features, dtype=bool)
    for (vid, start, end), v in zip(segments, vecs):
        lo = int(round(max(0.0, min(1.0, float(start))) * features))
        hi = int(round(max(0.0, min(1.0, float(end))) * features))
        if hi <= lo:
            raise ValueError(
                f"segment for '{vid}' is empty: start {start} is not below end {end}"
            )
        out[..., lo:hi] = v[..., lo:hi]
        covered[lo:hi] = True

    if not covered.all():
        gap = int((~covered).sum())
        raise ValueError(
            f"the segments leave {gap} of {features} features unset — a voice "
            f"with holes in its style vector does not render; cover 0% to 100%."
        )
    return out.astype(np.float32).ravel().tolist()
