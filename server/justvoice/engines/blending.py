# SPDX-License-Identifier: MIT
"""Host-side voice blending — file math, no engine process involved.

Managed engines run as subprocess procs the registry never holds, so a
python-call into an adapter could never reach them for blending. It also
never needed to: a Kokoro voice is a (510, 1, 256) float32 style array
sitting in the installed model file's embedded voices, and a blend is the
elementwise weighted average

    blend[i] = Σ(wⱼ · voiceⱼ[i]) / Σwⱼ

— the canonical Kokoro mix (slerp/lerp retired 2026-08-19). Creating a
blend therefore needs only files on disk; the engine can be unloaded.
Only *hearing* a blend needs the engine, and that rides the normal synth
path as ``SynthRequest.voice_vector``.

The math itself runs in `audiocpp_dsp` (audio/dsp_client.py, 2026-10-07):
this module resolves which voices, as raw float32 bytes, and checks shapes.

Per-engine dispatch is explicit because exactly one engine blends today.
Adding a second means adding its arm here — the requirement is an engine that
exports reloadable voice embeddings, which none of the others do.
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
    from ..audio.dsp_client import f32_list

    return f32_list(_kokoro_pack_mean(data_dir))


# ── Kokoro ───────────────────────────────────────────────────────────────


def _kokoro_gguf(data_dir: Path) -> Path:
    """The installed Kokoro model file — any downloaded variant (their voices are the same
    preset packs). No fetching — blending never triggers a download; the caller surfaces
    'download Kokoro first'."""
    from .. import speech_cache
    from .kokoro import manifest as kokoro_manifest

    for variant in kokoro_manifest.VARIANTS:
        vid = variant["id"]
        if speech_cache.variant_on_disk(data_dir, "kokoro", vid):
            d = Path(speech_cache.variant_dir(data_dir, "kokoro", vid))
            hits = sorted(d.rglob("*.gguf"))
            if hits:
                return hits[0]
    raise LookupError("Kokoro is not downloaded — download it on AI Settings → Speech engines first")


_PACK_CACHE: dict[tuple[str, int], tuple[dict, list, int]] = {}


def _kokoro_pack(data_dir: Path) -> tuple[dict[str, bytes], list[str], int]:
    """The preset voices as name → raw little-endian float32 rows × features, their names in
    `voices.json` order — a list, never a set: the mean sums float32 voices in this order, and a
    set's order follows Python's per-process string hashing, so the "mean" blend changed in its
    last bits on every server restart (TASKS, 2026-10-05; fixed 2026-10-06) — and the feature
    count (256).

    Since the 2026-10-01 switch Kokoro is one audio.cpp GGUF, and its voices are files
    embedded in it — `voices.json` plus `voices/<id>.bin`, raw float32 rows × 256
    (gap 2, docs/plans/2026-10-03-gap-2-kokoro-blends.md). Until 2026-10-03 this looked for
    the old engine's `voices*.bin`/`.npz` and every blend answered "kokoro is not installed".
    Read once per model file version."""
    import json

    from .audiocpp.gguf_files import embedded_files

    gguf = _kokoro_gguf(data_dir)
    key = (str(gguf), gguf.stat().st_mtime_ns)
    if key in _PACK_CACHE:
        return _PACK_CACHE[key]
    files = embedded_files(gguf)
    if "voices.json" not in files:
        raise LookupError(f"{gguf.name} carries no voices — re-download Kokoro")
    pack: dict[str, bytes] = {}
    features = 0
    for name, entry in json.loads(files["voices.json"]).items():
        raw = files.get(f"voices/{entry['path']}")
        if raw is None:
            continue
        rows, cols = int(entry["rows"]), int(entry["cols"])
        pack[name] = bytes(raw[: rows * cols * 4])
        features = features or cols
    _PACK_CACHE.clear()
    _PACK_CACHE[key] = (pack, list(pack), features)
    return _PACK_CACHE[key]


def _kokoro_pack_mean(data_dir: Path) -> bytes:
    """Centroid over every preset in the pack (float32 bytes, the pack's shape)."""
    from ..audio import dsp_client

    pack, names, _features = _kokoro_pack(data_dir)
    if not names:
        raise LookupError("kokoro voices file holds no voices")
    return dsp_client.vectors_mean([pack[n] for n in names])


def _kokoro_vectors(
    source_ids: list[str],
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
    *,
    shaped: bool = False,
) -> tuple[list[bytes], int]:
    """Resolve ids → float32 bytes, and the pack's feature count. `shaped` (recombine) needs a
    stored blend to have exactly a preset's size, so its feature axis lines up; otherwise
    (a weighted average) every source just needs the same size."""
    from ..audio import dsp_client

    pack, names, features = _kokoro_pack(data_dir)
    if not names:
        raise LookupError("kokoro voices file holds no voices")
    pack_size = len(pack[names[0]]) // 4
    mean_cache = None

    out: list[bytes] = []
    for vid in source_ids:
        if vid == MEAN_SOURCE:
            if mean_cache is None:
                mean_cache = _kokoro_pack_mean(data_dir)
            arr = mean_cache
        elif vid in names:
            arr = pack[vid]
        else:
            stored = resolve_stored(vid)
            if stored is None:
                raise LookupError(
                    f"unknown source voice '{vid}' — not a kokoro preset or a stored blend"
                )
            arr = dsp_client.f32_bytes(stored)
        if shaped and len(arr) // 4 != pack_size:
            raise ValueError(
                f"voice '{vid}' has {len(arr) // 4} values; this pack's voices "
                f"are {(pack_size // features, 1, features)} — re-blend against the installed pack."
            )
        out.append(arr)

    sizes = {len(v) // 4 for v in out}
    if len(sizes) != 1:
        raise ValueError(f"source voices have mismatched vector sizes: {sorted(sizes)}")
    return out, features


def _kokoro_blend(
    source_ids: list[str],
    weights: list[float],
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
    normalize: bool = True,
) -> list[float]:
    from ..audio import dsp_client

    vecs, _features = _kokoro_vectors(source_ids, data_dir, resolve_stored)
    if normalize and float(sum(weights)) == 0:
        raise ValueError("weights must sum to a non-zero value")
    return dsp_client.f32_list(dsp_client.vectors_blend(vecs, weights, normalize))


def _kokoro_recombine(
    segments: "list[tuple[str, float, float]]",
    data_dir: Path,
    resolve_stored: Callable[[str], "list[float] | None"],
) -> list[float]:
    from ..audio import dsp_client

    if not segments:
        raise ValueError("recombine needs at least one segment")

    ids = [s[0] for s in segments]
    vecs, features = _kokoro_vectors(ids, data_dir, resolve_stored, shaped=True)

    covered = [False] * features
    for vid, start, end in segments:
        lo = int(round(max(0.0, min(1.0, float(start))) * features))
        hi = int(round(max(0.0, min(1.0, float(end))) * features))
        if hi <= lo:
            raise ValueError(
                f"segment for '{vid}' is empty: start {start} is not below end {end}"
            )
        covered[lo:hi] = [True] * (hi - lo)

    if not all(covered):
        gap = covered.count(False)
        raise ValueError(
            f"the segments leave {gap} of {features} features unset — a voice "
            f"with holes in its style vector does not render; cover 0% to 100%."
        )
    spans = [(i, float(start), float(end)) for i, (_vid, start, end) in enumerate(segments)]
    return dsp_client.f32_list(dsp_client.vectors_recombine(vecs, spans, features))
