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
import re
import tempfile
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
    installed_exe,
)

log = logging.getLogger(__name__)

# Qwen3 takes language NAMES ("en" is rejected by audio.cpp — measured 2026-10-01).
QWEN_LANGUAGE = {"zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean", "de": "German",
                 "fr": "French", "ru": "Russian", "pt": "Portuguese", "es": "Spanish", "it": "Italian"}
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

    import numpy as np

    arr = np.asarray(vector, dtype="<f4").ravel()
    if arr.size == 0 or arr.size % 256:
        raise AudioCppError(f"a blended voice has {arr.size} values — Kokoro's are rows × 256")
    raw = arr.tobytes()
    out = _data_dir() / "cache" / "kokoro-voice-packs" / f"{hashlib.sha1(raw).hexdigest()}.bin"
    if not out.is_file():
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp")
        tmp.write_bytes(raw)
        tmp.replace(out)
    return out


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
    # The eSpeak NG phonemizer the runtime install fetched — Kokoro's and KittenTTS's
    # text frontends both read it.
    if spec["family"] in ESPEAK_FAMILIES:
        found = espeak.paths(engines_runtime_root())
        if found:
            opts["espeak_library_path"] = str(found[0])
            opts["espeak_data_path"] = str(found[1])
    out = [ModelEntry(row["id"], spec["family"], spec["task"], str(vdir / spec["file"]),
                      tuple(sorted(opts.items())))]
    for comp in spec.get("companions") or []:
        out.append(ModelEntry(f"{row['id']}::{comp['role']}", comp["family"], comp["task"],
                              str(vdir / comp["file"])))
    return out


def installed_entries() -> list[ModelEntry]:
    """Every model on disk across every engine — the server config's list."""
    from ...speech_cache import variant_on_disk
    from ..manager import get_manager

    out: list[ModelEntry] = []
    for m in get_manager().manifests().values():
        for row in getattr(m.module, "VARIANTS", []) or []:
            if row.get("audiocpp") and variant_on_disk(_data_dir(), m.id, row["id"]):
                out.extend(_entries_for(m, row))
    return out


ESPEAK_FAMILIES = ("kokoro_tts", "kitten_tts")


def effective_placement(placement: str) -> str:
    """Where a model asked for `placement` actually runs: a machine whose runtime IS the
    CPU build has only the CPU process."""
    exe = installed_exe()
    if exe is not None and backend_of(exe) == "cpu":
        return "cpu"
    return placement


def ensure_server(placement: str = "gpu"):
    """The running server for `placement` ("gpu" | "cpu"). The CPU process runs the
    installed build with `backend: cpu` — measured at 0 MB of graphics memory — at the
    CPU-threads setting (docs/plans/2026-10-02-cpu-placement.md §8)."""
    exe = installed_exe()
    if exe is None:
        raise RuntimeError("the speech runtime (audio.cpp) is not installed — install it on the AI page")
    placement = effective_placement(placement)
    srv = get_server(placement)
    if placement == "cpu":
        srv.ensure(exe, installed_entries(), data_dir=_data_dir(), device=configured_gpu(),
                   threads=cpu_threads(), backend="cpu")
    else:
        srv.ensure(exe, installed_entries(), data_dir=_data_dir(), device=configured_gpu())
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
        self.proc = None            # the server's Popen — its pid is what VRAM probes read
        self.port: int | None = None
        self._row: dict | None = None
        self._loaded = False
        self._generation = None
        # The first line / clip after a CPU load records its real-time factor (manager).
        self.speed_recorded = False

    def _srv(self):
        return get_server(self.placement)

    # -- lifecycle (manager.EngineProcess) --

    def spawn(self) -> None:
        srv = ensure_server(self.placement)
        self.proc = srv._run.proc
        self.port = srv._run.port
        self._generation = srv._run.proc.pid

    def is_alive(self) -> bool:
        srv = self._srv()
        return (self._loaded and srv.is_running() and srv._run.proc.pid == self._generation)

    def terminate(self) -> None:
        if self._row is not None and self._srv().is_running():
            try:
                self._srv().unload([e.id for e in _entries_for(self.manifest, self._row)])
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
            return _err(500, str(e))

    # -- /load --

    def _load(self, body: dict) -> _Resp:
        row = variant_spec(self.manifest, body.get("variant"))
        if row is None:
            return _err(400, f"{self.manifest.name} has no audio.cpp model for {body.get('variant')!r}")
        srv = ensure_server(self.placement)
        if not srv.has_model(row["id"]):
            return _err(400, f"{row.get('name', row['id'])} is not downloaded — download it on the AI page")
        self._row = row
        self.proc, self.port, self._generation = srv._run.proc, srv._run.port, srv._run.proc.pid
        self._loaded = True
        self._warm()
        return _Resp(200, payload={"ok": True, "variant": row["id"],
                                   "voices": list(self.manifest.static_voices)})

    def _warm(self) -> None:
        """Bring the model into memory now, so a Load means loaded (audio.cpp is lazy).
        Families that need a reference clip warm on their first real line instead."""
        spec = self._row["audiocpp"]
        srv = self._srv()
        try:
            if spec["family"] == "kokoro_tts":
                srv.speech({"model": self._row["id"], "input": "Ready.", "voice": "af_heart",
                            "language": "en-us", "seed": 1})
            elif spec["family"] == "kitten_tts":
                srv.speech({"model": self._row["id"], "input": "Ready.", "voice": "Leo"})
            elif spec["family"] == "pocket_tts":
                srv.speech({"model": self._row["id"], "input": "Ready.", "voice": "alba", "seed": 1})
            elif spec["family"] == "qwen3_tts" and spec["task"] == "tts" and not spec.get("clone"):
                srv.speech({"model": self._row["id"], "input": "Ready.", "language": "English",
                            "seed": 1, "options": {"speaker": "Ryan"}})
            elif spec["family"] == "qwen3_asr":
                srv.transcribe({"model": self._row["id"], "audio": _silence_path(),
                                "language": "English"})
            elif spec["family"] == "voxcpm2":
                # Designed, so it needs no clip. Without a warm-up the load measured nothing
                # (197 → 197 MB) and the memory ledger booked 0 MB for a multi-GB model.
                srv.speech({"model": self._row["id"], "input": "(A calm, clear voice)Ready.",
                            "seed": 1})
            elif spec["family"] == "chatterbox_turbo":
                # The app offers Turbo's cloned voices only, but its built-in voice needs no
                # clip, so a Load books its memory now rather than on the first line.
                srv.speech({"model": self._row["id"], "input": "Ready.", "seed": 1})
        except AudioCppError as e:
            log.info("audio.cpp warm-up of %s skipped: %s", self._row["id"], e)

    # -- /synth --

    def _synth(self, body: dict) -> _Resp:
        if not self.is_alive() or self._row is None:
            return _err(409, f"{self.manifest.name} is not loaded")
        if body.get("voice_vector"):
            if self._row["audiocpp"]["family"] != "kokoro_tts":
                return _err(422, f"{self.manifest.name} has no blended voices — blends are Kokoro's")
            from .runtime import has_feature

            if not has_feature("voice_pack"):   # the CPU process runs the same build
                return _err(409, "Blended voices need the speech runtime update — Update it on "
                                 "AI Settings → Speech engines.")
            body = {**body, "voice_pack_path": str(write_voice_pack(body["voice_vector"]))}
        if self._row["audiocpp"]["family"] == "chatterbox_turbo":
            from .runtime import has_feature

            if not has_feature("turbo_clone"):   # an older build refuses the clip inside
                return _err(409, f"{self._row.get('name', 'Chatterbox Turbo')} voices need the speech "
                                 "runtime update — Update it on AI Settings → Speech engines.")
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
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.write(base64.b64decode(body.get("wav_b64") or ""))
        tmp.close()
        return tmp.name.replace("\\", "/"), True

    def _transcribe(self, body: dict) -> _Resp:
        if not self.is_alive() or self._row is None:
            return _err(409, f"{self.manifest.name} is not loaded")
        path, temp = self._audio_path(body)
        try:
            req = {"model": self._row["id"], "audio": path}
            lang = (body.get("language") or "").split("-")[0].lower()
            if lang:
                req["language"] = QWEN_LANGUAGE.get(lang, lang)
            out = self._srv().transcribe(req)
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
        out = self._srv().align(f"{self._row['id']}::aligner", as_16k_mono(wav), body.get("text") or "",
                                 QWEN_LANGUAGE.get(lang, "English"))
        words = [{"word": w.get("word", ""), "start": float(w.get("start", 0.0)),
                  "end": float(w.get("end", 0.0))} for w in out.get("words") or []]
        return _Resp(200, payload={"words": words})


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
    upstream. A WAV this parser can't read (not 16-bit PCM) goes as it is."""
    from math import gcd

    from ...audio.wav import parse_wav_header, write_wav_container

    try:
        fmt, off, size = parse_wav_header(wav)
    except ValueError as e:
        log.warning("aligner input left as it is (%s) — word times may be scaled", e)
        return wav
    if fmt.sample_rate == ALIGN_RATE and fmt.channels == 1:
        return wav
    import numpy as np
    from scipy.signal import resample_poly

    x = np.frombuffer(wav[off:off + size], dtype="<i2").astype(np.float32)
    if fmt.channels > 1:
        x = x[: len(x) // fmt.channels * fmt.channels].reshape(-1, fmt.channels).mean(axis=1)
    if fmt.sample_rate != ALIGN_RATE:
        g = gcd(ALIGN_RATE, fmt.sample_rate)
        x = resample_poly(x, ALIGN_RATE // g, fmt.sample_rate // g)
    pcm = np.clip(np.round(x), -32768, 32767).astype("<i2").tobytes()
    return write_wav_container(pcm, ALIGN_RATE, 1)


_SILENCE: str | None = None


def _silence_path() -> str:
    """A third of a second of 16 kHz silence — the recogniser's warm-up input."""
    global _SILENCE
    if _SILENCE is None or not Path(_SILENCE).is_file():
        f = Path(tempfile.gettempdir()) / "justvoice-audiocpp-warmup.wav"
        with wave.open(str(f), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b"\x00\x00" * 5333)
        _SILENCE = str(f).replace("\\", "/")
    return _SILENCE


# ─── Our request → audio.cpp's (plan §3.4) ──────────────────────────────────


def to_speech_request(row: dict, body: dict) -> dict:
    """A manager synth body (`SynthRequest` as a dict) → `/v1/audio/speech` JSON."""
    spec = row["audiocpp"]
    family = spec["family"]
    delivery = body.get("delivery") or {}
    knobs = delivery.get("engine") or {}
    lang = (body.get("language") or "").lower()
    req: dict[str, Any] = {"model": row["id"], "input": body.get("text") or ""}
    if body.get("seed") is not None:
        req["seed"] = int(body["seed"])

    if family == "kokoro_tts":
        from ..kokoro.voices import VOICES

        voice = body.get("voice_id") or "af_heart"
        voice_lang = next((lg for vid, _n, lg, _g in VOICES if vid == voice), "en-us").lower()
        req["voice"] = voice
        req["language"] = KOKORO_LANGUAGE.get(lang or voice_lang,
                                              KOKORO_LANGUAGE.get((lang or voice_lang).split("-")[0], "en-us"))
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
        if delivery.get("phonemes"):
            opts["phonemes"] = [str(delivery["phonemes"])]
        if opts:
            req["options"] = opts
        return req

    if family == "qwen3_tts":
        req["language"] = QWEN_LANGUAGE.get(lang.split("-")[0] or "en", "English")
        opts: dict[str, Any] = {}
        temperature = delivery.get("temperature", knobs.get("talker_temperature"))
        for ours, theirs, cast in (("talker_top_k", "top_k", int), ("talker_top_p", "top_p", float),
                                   ("repetition_penalty", "repetition_penalty", float)):
            if knobs.get(ours) is not None:
                opts[theirs] = cast(knobs[ours])
        if temperature is not None:
            opts["temperature"] = float(temperature)
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
                                    "tick x-vector only.")
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
        opts = {}
        for ours, theirs in (("exaggeration", "exaggeration"), ("cfg_weight", "guidance_scale"),
                             ("repetition_penalty", "repetition_penalty"), ("top_p", "top_p")):
            if knobs.get(ours) is not None:
                opts[theirs] = float(knobs[ours])
        temperature = delivery.get("temperature", knobs.get("temperature"))
        if temperature is not None:
            opts["temperature"] = float(temperature)
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
            opts["temperature"] = float(temperature)
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
        if opts:
            req["options"] = opts
        return req

    raise AudioCppError(f"no speech mapping for the {family} family")


__all__ = ["AudioCppSlot", "ensure_server", "installed_entries", "to_speech_request", "variant_spec",
           "release"]
