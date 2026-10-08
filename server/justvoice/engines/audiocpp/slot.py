# SPDX-License-Identifier: MIT
"""Where an engine subprocess used to stand — now one model inside the audio.cpp server.

The engine manager spawns, POSTs `/load`, `/synth`, `/transcribe`, `/align`, GETs
`/voices`, and terminates. Until the switch each of those was an HTTP call into a Python
child running the model's reference code. `AudioCppSlot` answers the same calls by driving
the ONE audio.cpp server, so the manager's admission, VRAM bookings, per-kind slots and
cancel logic keep working untouched (plan §3.3).

Per-family request mapping (plan §3.4) lives here — the single place that knows how each
of our engines' requests reads in audio.cpp's terms. What audio.cpp cannot do yet refuses
by name instead of rendering the wrong thing (plan §5).
"""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import random
import re
import tempfile
import threading
import wave
from pathlib import Path
from typing import Any

from . import espeak, release
from .runtime import (
    AudioCppError,
    ModelEntry,
    backend_of,
    configured_gpu,
    cpu_threads,
    get_server,
    has_feature,
    installed_exe,
    request_timeout,
)

log = logging.getLogger(__name__)

# Qwen3 takes language NAMES ("en" is rejected by audio.cpp — measured 2026-10-01).
QWEN_LANGUAGE = {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "de": "German",
                 "fr": "French", "ru": "Russian", "pt": "Portuguese", "es": "Spanish", "it": "Italian"}
# Qwen3-ASR's 30 languages, by the names its prompt takes (the model card,
# huggingface.co/Qwen/Qwen3-ASR-1.7B, read 2026-10-04: `language="English"`, never a code). Until
# 2026-10-04 the twenty outside QWEN_LANGUAGE went as raw codes ("language ar"), and the aligner
# was told "English" for them — so Cantonese was aligned as space-separated words (audit §5 D7).
ASR_LANGUAGE = {**QWEN_LANGUAGE, "yue": "Cantonese", "ar": "Arabic", "id": "Indonesian", "th": "Thai",
                "vi": "Vietnamese", "tr": "Turkish", "hi": "Hindi", "ms": "Malay", "nl": "Dutch",
                "sv": "Swedish", "da": "Danish", "fi": "Finnish", "pl": "Polish", "cs": "Czech",
                "fil": "Filipino", "fa": "Persian", "el": "Greek", "ro": "Romanian", "hu": "Hungarian",
                "mk": "Macedonian"}
# The lowest temperature / top-p sent (audit §5 D4): Qwen3 refuses 0, Chatterbox divides by it,
# Turbo reads 0 as 1.0, and Qwen3 reads a top-p of 0 as "no filter".
_MIN_SAMPLING = 0.05
# Kokoro's text frontend codes (audio.cpp `--language`), from our catalog's tags.
KOKORO_LANGUAGE = {"en-us": "en-us", "en": "en-us", "en-gb": "en-gb", "ja": "ja", "zh": "zh", "es": "es",
                   "fr": "fr-fr", "hi": "hi", "it": "it", "pt-br": "pt-br", "pt": "pt-br"}


class _Resp:
    """The bit of httpx.Response the manager reads."""

    def __init__(self, status: int, content: bytes = b"", headers: dict | None = None,
                 payload: Any = None):
        self.status_code = status
        self.content = content
        self.headers = headers or {}
        self._payload = payload

    @property
    def text(self) -> str:
        if self._payload is not None:
            return json.dumps(self._payload)
        return self.content.decode("utf-8", "replace")

    def json(self) -> Any:
        return self._payload if self._payload is not None else json.loads(self.content or b"{}")

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(self.text)


def _err(status: int, msg: str) -> _Resp:
    return _Resp(status, payload={"detail": msg})


# ─── What the server is told it may load ────────────────────────────────────


def _data_dir() -> Path:
    from ...app_state import get_state

    return get_state().data_dir


def write_voice_pack(vector) -> Path:
    """A blend's style pack as the raw float32 rows × 256 file our audio.cpp's `voice_pack`
    option reads (gap 2). Named by its content, so each blend is written once and kept."""
    import hashlib
    import struct

    values = [float(v) for v in vector]
    if not values or len(values) % 256:
        raise AudioCppError(f"a blended voice has {len(values)} values — Kokoro's are rows × 256")
    raw = struct.pack(f"<{len(values)}f", *values)
    folder = _data_dir() / "cache" / "kokoro-voice-packs"
    out = folder / f"{hashlib.sha1(raw).hexdigest()}.bin"
    if out.is_file():
        out.touch()                          # in use: newest
        return out
    folder.mkdir(parents=True, exist_ok=True)
    # A name of its own per writer: two renders of the same blend at once shared one ".tmp".
    tmp = folder / f"{out.stem}.{os.getpid()}-{threading.get_ident()}.tmp"
    tmp.write_bytes(raw)
    tmp.replace(out)
    # Every blend auditioned left a pack for good (audit §5 F). A pack is rebuilt from its voice
    # whenever it is needed, so only the newest are kept.
    packs = sorted(folder.glob("*.bin"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in packs[_VOICE_PACKS_KEPT:]:
        old.unlink(missing_ok=True)
    return out


_VOICE_PACKS_KEPT = 200


def variant_spec(manifest, variant_id: str | None) -> dict | None:
    """The manifest row for `variant_id` (or the engine's default), with its `audiocpp` block."""
    rows = list(getattr(manifest.module, "VARIANTS", []) or [])
    want = variant_id if variant_id not in (None, "", "auto") else manifest.default_variant_id
    row = next((r for r in rows if r.get("id") == want), None)
    if row is None and rows:
        row = next((r for r in rows if r.get("id") == manifest.default_variant_id), rows[0])
    return row if row and row.get("audiocpp") else None


def _entries_for(manifest, row: dict) -> list[ModelEntry]:
    from ...speech_cache import variant_dir
    from ..manager import engines_runtime_root

    spec = row["audiocpp"]
    vdir = variant_dir(_data_dir(), manifest.id, row["id"])
    opts = dict(spec.get("session_options") or {})
    # The options the user set on the model's row (audit §13.5, 5h).
    from .runtime_options import session_options_for

    opts.update(session_options_for(manifest.id, row))
    # The eSpeak NG phonemizer the runtime install fetched. KittenTTS reads it from its own
    # prefixed session options; Kokoro reads only the runtime's environment
    # (`runtime._child_env`) and would refuse a session option it doesn't know.
    if spec["family"] in ESPEAK_SESSION_FAMILIES:
        found = espeak.paths(engines_runtime_root())
        if found:
            opts[f"{spec['family']}.espeak_library_path"] = str(found[0])
            opts[f"{spec['family']}.espeak_data_path"] = str(found[1])
    out = [ModelEntry(row["id"], spec["family"], spec["task"], str(vdir / spec["file"]),
                      tuple(sorted(opts.items())))]
    for comp in spec.get("companions") or []:
        out.append(ModelEntry(f"{row['id']}::{comp['role']}", comp["family"], comp["task"],
                              str(vdir / comp["file"])))
    return out


def installed_entries(kind: str) -> list[ModelEntry]:
    """Every model of `kind` ("tts" | "stt") on disk — the config's list for a build that
    can't register models at run time (`managed_runtime`)."""
    from ...speech_cache import variant_on_disk
    from ..manager import get_manager

    out: list[ModelEntry] = []
    for m in get_manager().manifests().values():
        if m.kind != kind:
            continue
        for row in getattr(m.module, "VARIANTS", []) or []:
            if row.get("audiocpp") and variant_on_disk(_data_dir(), m.id, row["id"]):
                out.extend(_entries_for(m, row))
    return out


def managed_runtime() -> bool:
    """Whether the installed build registers models at run time (`model_management`, our
    fork — audit 2026-10-04 §13.2): its processes start with no models and nothing downloaded
    or deleted restarts them."""
    return has_feature("model_management")


# The families that take eSpeak NG's paths as session options (audio.cpp
# community_models/kitten_tts/session.cpp:74 — `kitten_tts.espeak_library_path` /
# `kitten_tts.espeak_data_path`). Kokoro is not one: it reads the environment.
ESPEAK_SESSION_FAMILIES = ("kitten_tts",)


# What each build feature makes possible, as a refusal names it (release.FEATURES).
_FEATURE_WORDS = {
    "voice_pack": "Blended voices",
    "inline_ipa": "A lexicon's pronunciations on Kokoro",
    "turbo_clone": "Chatterbox Turbo and Nano voices",
    "chatterbox_he_ru_zh": "Chatterbox in Hebrew, Russian and Chinese",
    "japanese": "Japanese speech",
    "voxcpm2_transcript": "A VoxCPM2 clone's transcript",
}


def features_needed(row: dict, body: dict) -> list[str]:
    """The build features a synth of this line needs (`release.FEATURES`)."""
    family = row["audiocpp"]["family"]
    lang = (body.get("language") or "").split("-")[0].lower()
    out: list[str] = []
    if body.get("voice_vector"):
        out.append("voice_pack")
    if family == "chatterbox_turbo":
        out.append("turbo_clone")
    if family == "kokoro_tts":
        from ..kokoro.voices import VOICES

        voice_lang = next((lg for vid, _n, lg, _g in VOICES if vid == body.get("voice_id")), "")
        if (lang or voice_lang.lower()).startswith("ja"):
            out.append("japanese")
    if family == "chatterbox":
        if lang in ("he", "ru", "zh"):
            out.append("chatterbox_he_ru_zh")
        elif lang == "ja":
            out.append("japanese")
    if family == "voxcpm2" and body.get("audio_prompt_path") and body.get("ref_text"):
        out.append("voxcpm2_transcript")
    return out


def feature_refusal(feature: str) -> str:
    """Why a line can't be spoken on the installed build — an update to offer when the pinned
    build has the feature, else that this version doesn't have it yet. Until 2026-10-04 every
    refusal said "Update it on AI Settings" even when no update existed (audit §5 E3)."""
    words = _FEATURE_WORDS.get(feature, feature)
    if release.pinned_has(feature):
        return (f"{words} — this needs the speech runtime update. Update it on AI Settings → "
                "Speech engines.")
    return f"{words} — this isn't in this version's speech runtime yet."


def effective_placement(placement: str) -> str:
    """Where a model asked for `placement` actually runs: a machine whose runtime IS the
    CPU build has only the CPU process."""
    exe = installed_exe()
    if exe is not None and backend_of(exe) == "cpu":
        return "cpu"
    return placement


def ensure_server(placement: str = "gpu", kind: str = "tts"):
    """The running server for `placement` ("gpu" | "cpu") and `kind` ("tts" | "stt"). The CPU
    process runs the installed build with `backend: cpu` — measured at 0 MB of graphics
    memory — at the CPU-threads setting (docs/plans/2026-10-02-cpu-placement.md §8)."""
    exe = installed_exe()
    if exe is None:
        raise RuntimeError("the speech runtime (audio.cpp) is not installed — install it on the AI page")
    placement = effective_placement(placement)
    srv = get_server(placement, kind)
    managed = managed_runtime()
    models = [] if managed else installed_entries(kind)
    if placement == "cpu":
        srv.ensure(exe, models, data_dir=_data_dir(), device=configured_gpu(),
                   threads=cpu_threads(), backend="cpu", managed=managed)
    else:
        srv.ensure(exe, models, data_dir=_data_dir(), device=configured_gpu(), managed=managed)
    return srv


def terms_accepted(engine_id: str) -> bool:
    """Has the user accepted this engine's own terms (manifest TERMS)? Best-effort: no
    app state (bare tests) reads as not accepted."""
    try:
        from ...app_state import get_state

        ov = get_state().settings.get().engines.engine_overrides.get(engine_id)
        return bool(ov and ov.terms_accepted_at)
    except Exception:  # noqa: BLE001
        return False


# The refusal's machine-readable code — the manager turns it into TermsRequired, which
# the API answers with 403 + `code: terms_required` so the app can show the terms.
TERMS_REQUIRED = "terms_required"


# ─── The slot ───────────────────────────────────────────────────────────────


class AudioCppSlot:
    """One engine's model resident in one of the runtime's servers (manager.EngineProcess's
    shape). `placement` ("gpu" | "cpu") is which server — the manager decides it."""

    def __init__(self, manifest, placement: str = "gpu"):
        self.manifest = manifest
        self.placement = effective_placement(placement)
        # Speech and speech recognition each have their own process (audit §13.2).
        self.kind = "stt" if manifest.kind == "stt" else "tts"
        self.proc = None            # the server's Popen — its pid is what VRAM probes read
        self.port: int | None = None
        self._row: dict | None = None
        self._loaded = False
        self._generation = None
        # The first line / clip after a CPU load records its real-time factor (manager).
        self.speed_recorded = False

    def _srv(self):
        return get_server(self.placement, self.kind)

    # -- lifecycle (manager.EngineProcess) --

    def spawn(self) -> None:
        srv = ensure_server(self.placement, self.kind)
        self.proc = srv._run.proc
        self.port = srv._run.port
        self._generation = srv._run.proc.pid

    def is_alive(self) -> bool:
        srv = self._srv()
        return (self._loaded and srv.is_running() and srv.pid == self._generation)

    def is_dead(self) -> bool:
        """It had loaded, and the process holding its model is gone or replaced — the model
        went with it. A slot still loading is not dead."""
        return self._loaded and not self.is_alive()

    def terminate(self) -> None:
        srv = self._srv()
        if self._row is not None and srv.is_running() and srv.pid == self._generation:
            ids = [e.id for e in _entries_for(self.manifest, self._row)]
            if srv.managed:
                ids = [i for i in ids if srv.has_model(i)]
            try:
                srv.unload(ids)
            except AudioCppError as e:
                log.warning("audio.cpp unload of %s failed: %s", self._row["id"], e)
        self._loaded = False

    def get(self, path: str) -> _Resp:
        if path == "/voices":
            return _Resp(200, payload={"voices": list(self.manifest.static_voices)})
        if path == "/health":
            return _Resp(200 if self._srv().is_running() else 503, payload={})
        return _err(404, f"{path} has no audio.cpp equivalent")

    def post(self, path: str, json: dict | None = None, timeout: float | None = None) -> _Resp:
        body = json or {}
        try:
            if path == "/load":
                return self._load(body)
            if path == "/synth":
                return self._synth(body)
            if path == "/transcribe":
                return self._transcribe(body)
            if path == "/align":
                return self._align(body)
            if path == "/shutdown":
                return _Resp(200, payload={})
            return _err(501, f"{self.manifest.name} has no {path} in audio.cpp")
        except AudioCppError as e:
            # audio.cpp's own status survives — out of memory and busy are 503, a bad request 400
            # (audit §5 D8).
            return _err(e.status if 400 <= e.status < 600 else 500, str(e))

    # -- /load --

    def _load(self, body: dict) -> _Resp:
        row = variant_spec(self.manifest, body.get("variant"))
        if row is None:
            return _err(400, f"{self.manifest.name} has no audio.cpp model for {body.get('variant')!r}")
        from ...speech_cache import variant_on_disk

        if not variant_on_disk(_data_dir(), self.manifest.id, row["id"]):
            return _err(400, f"{row.get('name', row['id'])} is not downloaded — download it on the AI page")
        srv = ensure_server(self.placement, self.kind)
        if srv.managed:
            # Registered and loaded now — a Load means loaded. Companions (the aligner)
            # register on their first use, as they loaded lazily before.
            srv.register(_entries_for(self.manifest, row)[0])
        self._row = row
        self.proc, self.port, self._generation = srv._run.proc, srv._run.port, srv._run.proc.pid
        self._loaded = True
        calibrated = self._warm(int(body.get("calibrate_chars") or 0))
        return _Resp(200, payload={"ok": True, "variant": row["id"], "calibrated": calibrated,
                                   "voices": list(self.manifest.static_voices)})

    def _warm(self, calibrate_chars: int = 0) -> bool:
        """Speak once now, so a Load means loaded and its memory is measured — audio.cpp loads
        lazily on a build without `model_management`, and allocates a model's working buffers
        on its first line on any build. `calibrate_chars` > 0: this model has no price on the
        card yet, so the warm-up is a FULL-LENGTH piece (`CALIBRATION_TEXT` cut to that length,
        never longer than audio.cpp's own budget for the family; speech recognition gets its
        30 s chunk of silence) and what the process holds after it is this model's peak (audit
        2026-10-04 §13.3). Returns whether it calibrated. A family that speaks only from a clip
        (Chatterbox Multilingual, Qwen3 Base) warms on its first real line instead.

        A failure fails the Load with audio.cpp's own words — until 2026-10-04 it was logged
        and the Load said ready (audit §5 B4)."""
        spec = self._row["audiocpp"]
        family, task = spec["family"], spec["task"]
        n = min(calibrate_chars, _FAMILY_BUDGET.get(family, calibrate_chars)) if calibrate_chars else 0
        text = calibration_text(n) if n else "Ready."
        model, srv = self._row["id"], self._srv()
        if family == "kokoro_tts":
            srv.speech({"model": model, "input": text, "voice": "af_heart", "language": "en-us",
                        "seed": 1})
        elif family == "kitten_tts":
            srv.speech({"model": model, "input": text, "voice": "Leo"})
        elif family == "pocket_tts":
            srv.speech({"model": model, "input": text, "voice": "alba", "seed": 1})
        elif family == "qwen3_tts" and task == "vdes":
            # Designed from words, so it needs no clip (it had no warm-up until 2026-10-04).
            srv.speech({"model": model, "input": text, "language": "English", "seed": 1,
                        "instructions": "A calm, clear narrator."})
        elif family == "qwen3_tts" and task == "tts" and not spec.get("clone"):
            srv.speech({"model": model, "input": text, "language": "English", "seed": 1,
                        "options": {"speaker": "Ryan"}})
        elif family == "qwen3_asr":
            seconds = _CALIBRATION_AUDIO_S if calibrate_chars else 1 / 3
            srv.transcribe({"model": model, "language": "English", "audio": _silence_path(seconds)})
            return bool(calibrate_chars)
        elif family == "voxcpm2":
            # Designed, so it needs no clip. Without a warm-up the load measured nothing
            # (197 -> 197 MB) and the memory ledger booked 0 MB for a multi-GB model.
            srv.speech({"model": model, "input": f"(A calm, clear voice){text}", "seed": 1})
        elif family == "chatterbox_turbo":
            # The app offers Turbo's cloned voices only, but its built-in voice needs no
            # clip, so a Load books its memory now rather than on the first line.
            srv.speech({"model": model, "input": text, "seed": 1})
        else:
            return False
        return bool(n)

    # -- /synth --

    def _synth(self, body: dict) -> _Resp:
        if not self.is_alive() or self._row is None:
            return _err(409, f"{self.manifest.name} is not loaded")
        if body.get("voice_vector") and self._row["audiocpp"]["family"] != "kokoro_tts":
            return _err(422, f"{self.manifest.name} has no blended voices — blends are Kokoro's")
        # What this line needs from the INSTALLED build (the CPU process runs the same one), each
        # refused by name before audio.cpp fails inside or ignores it (audit §5 E1).
        for feature in features_needed(self._row, body):
            if not has_feature(feature):
                return _err(409, feature_refusal(feature))
        if body.get("voice_vector"):
            body = {**body, "voice_pack_path": str(write_voice_pack(body["voice_vector"]))}
        terms = getattr(self.manifest.module, "TERMS", None)
        if (terms and terms.get("gates") == "cloning" and body.get("audio_prompt_path")
                and not terms_accepted(self.manifest.id)):
            return _Resp(403, payload={
                "detail": f"{self.manifest.name} clones a voice only after you accept "
                          f"{terms.get('owner', 'its makers')}'s terms — open Voices → Clone with "
                          f"{self.manifest.name}, or AI Settings → Speech engines, to read and accept them.",
                "code": TERMS_REQUIRED, "engine": self.manifest.id})
        req = to_speech_request(self._row, body)
        wav, headers = self._srv().speech(req)
        with wave.open(io.BytesIO(wav)) as w:
            sr, ch = w.getframerate(), w.getnchannels()
        return _Resp(200, wav, headers={"content-type": "audio/wav", "X-JustVoice-Sample-Rate": str(sr),
                                        "X-JustVoice-Channels": str(ch), "X-JustVoice-WAV-Container": "1"})

    # -- /transcribe, /align --

    def _audio_path(self, body: dict) -> tuple[str, bool]:
        if body.get("audio_path"):
            return str(body["audio_path"]).replace("\\", "/"), False
        raw = base64.b64decode(body.get("wav_b64") or "")   # before the file: a bad upload leaves none
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        with tmp:
            tmp.write(raw)
        return tmp.name.replace("\\", "/"), True

    def _transcribe(self, body: dict) -> _Resp:
        if not self.is_alive() or self._row is None:
            return _err(409, f"{self.manifest.name} is not loaded")
        path, temp = self._audio_path(body)
        try:
            req = {"model": self._row["id"], "audio": path}
            lang = (body.get("language") or "").split("-")[0].lower()
            if lang in ASR_LANGUAGE:
                req["language"] = ASR_LANGUAGE[lang]      # anything else: detected
            out = self._srv().transcribe(req, timeout=_transcribe_timeout(path))
        finally:
            if temp:
                Path(path).unlink(missing_ok=True)
        # audio.cpp's recognisers report no confidence — None means UNKNOWN, never zero.
        return _Resp(200, payload={"text": (out.get("text") or "").strip(), "confidence": None})

    def _align(self, body: dict) -> _Resp:
        if not self.is_alive() or self._row is None:
            return _err(409, f"{self.manifest.name} is not loaded")
        aligner = next((c for c in self._row["audiocpp"].get("companions") or [] if c["role"] == "aligner"), None)
        if aligner is None:
            return _err(501, "this speech-recognition model has no word aligner")
        wav = (Path(body["audio_path"]).read_bytes() if body.get("audio_path")
               else base64.b64decode(body.get("wav_b64") or ""))
        lang = (body.get("language") or "en").split("-")[0].lower()
        srv = self._srv()
        aligner_id = f"{self._row['id']}::aligner"
        if srv.managed and not srv.has_model(aligner_id):
            srv.register(next(e for e in _entries_for(self.manifest, self._row) if e.id == aligner_id))
        out = srv.align(aligner_id, as_16k_mono(wav), body.get("text") or "",
                        ASR_LANGUAGE.get(lang, "English"))
        words = [{"word": w.get("word", ""), "start": float(w.get("start", 0.0)),
                  "end": float(w.get("end", 0.0))} for w in out.get("words") or []]
        return _Resp(200, payload={"words": words})


def _transcribe_timeout(path: str) -> float:
    """How long a transcription may take: the request timeout setting, or three times the
    recording — speech recognition runs at about 2x real time on the CPU, so a fixed 600 s
    timed out recordings longer than ~20 minutes (audit §5 D9)."""
    floor = request_timeout()
    try:
        with wave.open(path) as w:
            seconds = w.getnframes() / float(w.getframerate() or 1)
    except Exception:  # noqa: BLE001 — not a WAV the stdlib reads: the floor
        return floor
    return max(floor, 3.0 * seconds)


ALIGN_RATE = 16_000   # the rate audio.cpp's Qwen3 aligner works at

# Names for the languages a refusal may need to say (Pocket TTS's five, plus the codes a
# line may carry); anything else is said as its code.
_LANG_WORDS = {"en": "English", "de": "German", "it": "Italian", "pt": "Portuguese", "es": "Spanish",
               "fr": "French", "ja": "Japanese", "zh": "Chinese", "ru": "Russian", "ko": "Korean"}


def _lang_word(code: str) -> str:
    return _LANG_WORDS.get(code, code)


def as_16k_mono(wav: bytes) -> bytes:
    """The aligner's input, at the aligner's own rate.

    audio.cpp v0.9.0's /v1/audio/alignments resamples to 16 kHz correctly but turns sample
    positions into seconds with the INPUT rate: a 24 kHz render came back at exactly 2/3 of
    its real word times (measured 2026-10-01 — the sample indices matched, the seconds did
    not). Sent at 16 kHz mono the seconds are right, and they stay right once that is fixed
    upstream. A WAV this parser can't read (not 16-bit PCM) goes as it is. Our builds fixed it
    (jv.1); an install still on v0.9.0 needs this. The conversion — channels averaged, resampled,
    rounded — runs in audiocpp_dsp (2026-10-07; ported exactly, it was numpy and scipy)."""
    from ...audio import dsp_client
    from ...audio.wav import parse_wav_header

    try:
        fmt, _off, _size = parse_wav_header(wav)
    except ValueError as e:
        log.warning("aligner input left as it is (%s) — word times may be scaled", e)
        return wav
    if fmt.sample_rate == ALIGN_RATE and fmt.channels == 1:
        return wav
    return dsp_client.aligner_input(wav, ALIGN_RATE)


_SILENCE: dict[int, str] = {}


def _silence_path(seconds: float = 1 / 3) -> str:
    """`seconds` of 16 kHz silence — the recogniser's warm-up input (a third of a second) or
    its calibration (its 30 s chunk). One file per length, written once per run."""
    frames = int(seconds * 16000)
    path = _SILENCE.get(frames)
    if path is None or not Path(path).is_file():
        f = Path(tempfile.gettempdir()) / f"justvoice-audiocpp-silence-{frames}.wav"
        with wave.open(str(f), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00" * frames)
        path = _SILENCE[frames] = str(f).replace("\\", "/")
    return path


# What a calibrating warm-up speaks (audit 2026-10-04 §13.3): ordinary narration, cut at a
# sentence end to the piece length the model is given — what its working memory reaches.
CALIBRATION_TEXT = (
    "The ferry was late again, and nobody on the quay looked surprised. Marius set the lamp on "
    "the table and counted the doors until the ninth. The fog came in over the pier before "
    "either of them said a word, and the harbour went quiet. June leaned against the doorframe "
    "with her arms crossed, watching the last of the light drain out of the sky, and said "
    "nothing at all for a long while. When she finally spoke, it was to ask about the boats, "
    "and whether the tide had turned, and whether anyone had thought to bring the lanterns in "
    "from the far end of the pier. Nobody had. The boy went, grumbling, and came back with three "
    "of them swinging from one hand and his collar turned up against the damp, and set them "
    "down in a row by the door without being told. Outside, the bell on the channel buoy rang "
    "twice and then fell silent, as if it too were waiting to see what the night would bring."
)
# audio.cpp's own piece budget for a family, in characters — it splits longer input itself, so
# a calibrating piece is never longer (Chatterbox and Turbo session.cpp, Kokoro and Kitten
# frontends; audit §5 D5).
_FAMILY_BUDGET = {"chatterbox": 128, "chatterbox_turbo": 128, "kokoro_tts": 240, "kitten_tts": 400}
# Speech recognition is calibrated with its own chunk of audio (`audio_chunk_seconds`, 30 s).
_CALIBRATION_AUDIO_S = 30.0


def calibration_text(chars: int) -> str:
    """`CALIBRATION_TEXT` cut at a word to as close to `chars` characters as it goes — the
    memory follows the length, so a piece cut short at a sentence end would under-measure."""
    if chars >= len(CALIBRATION_TEXT):
        return CALIBRATION_TEXT
    n = max(40, chars)
    head = CALIBRATION_TEXT[:n]
    if CALIBRATION_TEXT[n:n + 1] != " ":
        head = head.rsplit(" ", 1)[0]          # never half a word
    head = head.rstrip(" ,;.")
    return head + "." if len(head) < n else head[:-1] + "."


# ─── Our request → audio.cpp's (plan §3.4) ──────────────────────────────────


JAPANESE_DICTIONARY_MISSING = "Japanese needs the Japanese dictionary — install it on AI Settings → Speech engines."


def _require_japanese_dictionary() -> None:
    """Kokoro's Japanese voices and Chatterbox in Japanese read MeCab's UniDic dictionary — the
    optional download on the runtime row (gap 7); without it, refused by name."""
    from . import japanese
    from ..manager import engines_runtime_root

    if japanese.dictionary_dir(engines_runtime_root()) is None:
        raise AudioCppError(JAPANESE_DICTIONARY_MISSING)


def to_speech_request(row: dict, body: dict) -> dict:
    """A manager synth body (`SynthRequest` as a dict) → `/v1/audio/speech` JSON."""
    spec = row["audiocpp"]
    family = spec["family"]
    delivery = body.get("delivery") or {}
    knobs = delivery.get("engine") or {}
    lang = (body.get("language") or "").lower()
    req: dict[str, Any] = {"model": row["id"], "input": body.get("text") or ""}
    # No seed — or 0, which the seed control calls random — is a new take each time. audio.cpp's
    # own "no seed" is not random everywhere: Kokoro and Kitten keep the session's seed, Turbo a
    # fixed one, VoxCPM2 1234 (audit §5 D1), so a random one is sent. A description voice never
    # arrives here without one (render_core.description_seed).
    seed = body.get("seed")
    req["seed"] = int(seed) if seed not in (None, 0, "0", "") else random.randrange(1, 2**31)

    if family == "kokoro_tts":
        from ..kokoro.voices import VOICES

        voice = body.get("voice_id") or "af_heart"
        voice_lang = next((lg for vid, _n, lg, _g in VOICES if vid == voice), "en-us").lower()
        req["voice"] = voice
        req["language"] = KOKORO_LANGUAGE.get(lang or voice_lang,
                                              KOKORO_LANGUAGE.get((lang or voice_lang).split("-")[0], "en-us"))
        if voice_lang.startswith("ja") and not body.get("voice_pack_path"):
            _require_japanese_dictionary()
        if delivery.get("ipa_map"):
            # A lexicon's IPA: the words it covers ride as "[word](/phonemes/)" (gap 3). The host
            # sends an ipa_map only when the installed runtime splices (render_core).
            from ..kokoro.ipa import splice

            req["input"] = splice(req["input"], delivery["ipa_map"])
        opts: dict[str, Any] = {}
        if body.get("voice_pack_path"):
            # A blend: its pack rides `voice_pack`; the voice id only picks the language and
            # the G2P, so it is the first preset that speaks the blend's language.
            opts["voice_pack"] = str(body["voice_pack_path"]).replace("\\", "/")
            req["voice"] = next((vid for vid, _n, lg, _g in VOICES
                                 if KOKORO_LANGUAGE.get(lg.lower(), lg.lower()) == req["language"]),
                                "af_heart")
        if delivery.get("speed"):
            req["speed"] = float(delivery["speed"])
        if opts:
            req["options"] = opts
        return req

    if family == "qwen3_tts":
        # A language Qwen3 doesn't speak goes as "Auto" (it detects, and a CustomVoice speaker
        # keeps its own dialect) — not "English", which forced the English token (audit §5 D6).
        base = lang.split("-")[0] or "en"
        req["language"] = QWEN_LANGUAGE.get(base, "Auto")
        opts: dict[str, Any] = {}
        temperature = delivery.get("temperature", knobs.get("talker_temperature"))
        for ours, theirs, cast in (("talker_top_k", "top_k", int), ("talker_top_p", "top_p", float),
                                   ("repetition_penalty", "repetition_penalty", float),
                                   ("subtalker_temperature", "subtalker_temperature", float),
                                   ("subtalker_top_k", "subtalker_top_k", int),
                                   ("subtalker_top_p", "subtalker_top_p", float)):
            if knobs.get(ours) is not None:
                opts[theirs] = cast(knobs[ours])
        if temperature is not None:
            opts["temperature"] = max(_MIN_SAMPLING, float(temperature))
        # A top-p of 0 is "no filter" and a sampling temperature of 0 is refused (audit §5 D4, D9).
        for key in ("top_p", "subtalker_top_p", "subtalker_temperature"):
            if key in opts:
                opts[key] = max(_MIN_SAMPLING, opts[key])
        instruct = (delivery.get("instruct") or knobs.get("instruct") or "").strip()
        if spec["task"] == "vdes":
            if not instruct:
                raise AudioCppError("VoiceDesign renders from a voice description and this voice has none")
            req["instructions"] = instruct
        elif body.get("audio_prompt_path"):
            if not spec.get("clone"):
                raise AudioCppError("the CustomVoice model cannot clone — use a Base model for this voice")
            req["voice_ref"] = str(body["audio_prompt_path"]).replace("\\", "/")
            # audio.cpp clones a Base voice in ICL mode (the clip and what it says) unless
            # `x_vector_only_mode` asks for the speaker vector alone, and ICL without a transcript
            # is refused — so a clip with neither is refused here, by name (decided 2026-10-03).
            if body.get("xvector_only"):
                opts["x_vector_only_mode"] = True
            elif body.get("ref_text"):
                req["reference_text"] = body["ref_text"]
            else:
                raise AudioCppError("Qwen3 Base needs what the clip says — type the transcript, or "
                                    "tick Skip the words.")
        else:
            if spec.get("clone"):
                raise AudioCppError("the Base model is clone-only — this voice needs a reference clip")
            opts["speaker"] = body.get("voice_id")
            if instruct:
                opts["instruct"] = instruct
        if opts:
            req["options"] = opts
        return req

    if family == "kitten_tts":
        from ..kitten.manifest import AUDIOCPP_VOICE

        req["voice"] = AUDIOCPP_VOICE.get(body.get("voice_id") or "", "Leo")
        if delivery.get("speed"):
            req["speed"] = float(delivery["speed"])
        return req

    if family == "pocket_tts":
        # One model per language: a line in another language is refused by name, as
        # Qwen3 refuses the wrong checkpoint (docs/plans/2026-10-02-cpu-placement.md §8).
        speaks = [str(x).split("-")[0].lower() for x in row.get("languages") or []]
        base = lang.split("-")[0]
        if base and speaks and base not in speaks:
            raise AudioCppError(
                f"the loaded {row.get('name', 'Pocket TTS')} model speaks {_lang_word(speaks[0])}, and "
                f"this line is {_lang_word(base)} — load the {_lang_word(base)} Pocket TTS model for it")
        if body.get("audio_prompt_path"):
            req["voice_ref"] = str(body["audio_prompt_path"]).replace("\\", "/")
        else:
            from ..pocket.manifest import AUDIOCPP_VOICE

            req["voice"] = AUDIOCPP_VOICE.get(body.get("voice_id") or "", "alba")
        return req

    if family == "chatterbox":
        if not body.get("audio_prompt_path"):
            raise AudioCppError("Chatterbox speaks only cloned voices — this voice has no reference clip")
        req["voice_ref"] = str(body["audio_prompt_path"]).replace("\\", "/")
        req["language"] = (lang.split("-")[0] or "en")
        if req["language"] == "ja":
            _require_japanese_dictionary()
        opts = {}
        for ours, theirs in (("exaggeration", "exaggeration"), ("cfg_weight", "guidance_scale"),
                             ("repetition_penalty", "repetition_penalty"), ("top_p", "top_p"),
                             ("min_p", "min_p"), ("s3gen_cfg_rate", "s3gen_cfg_rate")):
            if knobs.get(ours) is not None:
                opts[theirs] = float(knobs[ours])
        temperature = delivery.get("temperature", knobs.get("temperature"))
        if temperature is not None:
            opts["temperature"] = max(_MIN_SAMPLING, float(temperature))
        if opts:
            req["options"] = opts
        return req

    if family == "chatterbox_turbo":
        # Turbo and Nano (gap 1): English, cloned voices only — our audio.cpp needs a clip
        # longer than 5 s and refuses a shorter one by name. Exaggeration / CFG / min-p do
        # nothing on Turbo, so only its own sampling knobs are sent.
        if not body.get("audio_prompt_path"):
            raise AudioCppError(f"{row.get('name', 'Chatterbox Turbo')} speaks only cloned voices — "
                                "this voice has no reference clip")
        req["voice_ref"] = str(body["audio_prompt_path"]).replace("\\", "/")
        opts = {}
        for key in ("repetition_penalty", "top_p"):
            if knobs.get(key) is not None:
                opts[key] = float(knobs[key])
        if knobs.get("top_k") is not None:
            opts["top_k"] = int(knobs["top_k"])
        temperature = delivery.get("temperature", knobs.get("temperature"))
        if temperature is not None:
            opts["temperature"] = max(_MIN_SAMPLING, float(temperature))
        if opts:
            req["options"] = opts
        return req

    if family == "voxcpm2":
        # One model clones (the clip) and designs (a description). VoxCPM2 takes a description,
        # or a line's direction on a clone, as a parenthesised prefix on the text, which
        # audio.cpp splits off and does not speak (manifest docstring).
        instruct = " ".join((delivery.get("instruct") or knobs.get("instruct") or "").split())
        if body.get("audio_prompt_path"):
            req["voice_ref"] = str(body["audio_prompt_path"]).replace("\\", "/")
            if body.get("ref_text"):
                # Reaches the model once our copy of audio.cpp passes the clip as prompt audio.
                req["reference_text"] = body["ref_text"]
        elif not instruct:
            raise AudioCppError("VoxCPM2 speaks a cloned voice or a designed one — this voice has "
                                "neither a reference clip nor a description")
        # VoxCPM2 treats ANY parenthesised text as direction and does not speak it — mid-line
        # too ("He left (quietly) and…" came back without "quietly", 2026-10-02). The line's
        # own brackets become dashes so its words are spoken; only our tag uses brackets.
        text = re.sub(r"\s*\(\s*|\s*\)\s*", " — ", req["input"])
        text = re.sub(r"(?:\s*—\s*){2,}", " — ", text).strip(" —")
        if instruct:
            text = f"({instruct.replace('(', '').replace(')', '')}){text}"
        req["input"] = text
        opts: dict[str, Any] = {}
        if knobs.get("cfg_value") is not None:
            opts["guidance_scale"] = float(knobs["cfg_value"])
        if knobs.get("inference_timesteps") is not None:
            opts["num_inference_steps"] = int(knobs["inference_timesteps"])
        if knobs.get("retry_badcase_max_times") is not None:
            opts["retry_badcase_max_times"] = max(1, int(knobs["retry_badcase_max_times"]))
        if knobs.get("retry_badcase_ratio_threshold") is not None:
            opts["retry_badcase_ratio_threshold"] = float(knobs["retry_badcase_ratio_threshold"])
        if opts:
            req["options"] = opts
        return req

    raise AudioCppError(f"no speech mapping for the {family} family")


__all__ = ["AudioCppSlot", "ensure_server", "installed_entries", "to_speech_request", "variant_spec",
           "release"]
