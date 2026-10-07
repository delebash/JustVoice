"""Pydantic models for the entire API surface.

One file because they cross-reference each other heavily and the
total stays under ~600 lines. The Rust crate split these across many
modules; in Python the import overhead from many small files is worse
than the readability cost of one bigger file.

Models are grouped by domain with section comment dividers.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, get_args

# LLM provider / feature-pin / production-config models are the SHARED
# contract — single-sourced in llm_runner.llm.schema (2026-06-21 AI-stack
# convergence) and reused here so JV settings + the shared dispatch never
# drift. (Previously duplicated verbatim in this file.)
# LLMRolesSettings/LLMRoleTarget are GONE (2026-08-01, full-convergence
# ruling): the shared package deleted the roles concept with 7232214 —
# features resolve production-config → pin → prefer-local → first — and JV
# kept importing the deleted names, which is what broke its server for
# weeks. scripts/check-consumers.py in just-llm-runner now catches that
# class of break at the deletion site.
from llm_runner.llm.schema import (
    LLMProviderConfig,
)
from pydantic import BaseModel, ConfigDict, Field

# ─── Common / system ────────────────────────────────────────────────────


class EngineHealth(BaseModel):
    id: str
    name: str
    ready: bool
    backend: str


class HealthResponse(BaseModel):
    # Family health baseline (F1 Phase 2): `product` + camel `apiVersion` are
    # what the family's checkers read; the snake extras below stay for JV's
    # own consumers (the topbar engine pill reads current_engine).
    product: str = ""
    apiVersion: str = ""  # camelCase on purpose — the family wire name
    status: Literal["ok", "degraded", "down"] = "ok"
    version: str
    api_version: str
    current_engine: str | None = None
    # The loaded model by its own name (*Kokoro 82M*, *Qwen3-TTS CustomVoice 1.7B*) — what
    # the top bar and Home show; the engine id above is for code (2026-10-06, one wording
    # per fact: a model is shown by its name).
    current_model: str | None = None
    engines: list[EngineHealth] = []


class GpuInfo(BaseModel):
    vendor: str
    name: str
    vram_mb: int | None = None
    driver: str | None = None


class SystemInfo(BaseModel):
    os: str
    cpu_name: str
    cpu_cores: int
    ram_total_mb: int
    gpus: list[GpuInfo] = []
    runtimes: dict[str, bool] = Field(
        default_factory=dict,
        description="Detected runtime availability: cuda / vulkan / rocm / metal / cpu",
    )
    ffmpeg: dict[str, Any] | None = None
    # Server's data directory — lets the desktop shell open on-disk
    # artifacts (the rotating log file) at their real location.
    data_dir: str | None = None


# ─── Settings ───────────────────────────────────────────────────────────


class ServerSettings(BaseModel):
    host: str = "127.0.0.1"
    port: int = 17494
    docs_enabled: bool = True


class LoggingSettings(BaseModel):
    level: str = "info"
    format: str = "pretty"


class CacheSettings(BaseModel):
    max_memory_entries: int = 64
    max_disk_bytes_per_scope: int = 5 * 1024 * 1024 * 1024
    enabled: bool = True


class LimitsSettings(BaseModel):
    text_max_chars: int = 50_000
    chapter_max_lines: int = 5_000
    reference_clip_max_bytes: int = 50 * 1024 * 1024
    request_body_max_bytes: int = 100 * 1024 * 1024


class GenerationSettings(BaseModel):
    """Knobs for the chunked TTS pipeline (Phase 3 upstream MIT lift; see audio/chunked.py header).

    Long text is split at sentence boundaries into chunks, generated
    per-chunk via the active engine, then concatenated with a short
    crossfade to eliminate clicks. Short text (≤ max_chunk_chars) skips
    chunking entirely via the single-shot fast path.
    """

    max_chunk_chars: int = 800  # 100-5000 in UI slider
    crossfade_ms: int = 50  # 0-200 in UI slider; 0 = hard cut
    # Audition streaming (phase 1, 2026-08-19): GET /preview/stream splits
    # the line into pieces of at most this many characters (the splitter
    # prefers sentence ends) and sends each as it renders, so playback
    # starts after the first piece. Sentence-sized on purpose — the
    # max_chunk_chars ceiling above is a truncation guard, far too big to
    # buy any time-to-first-audio.
    stream_piece_chars: int = 200  # 80-800 in UI slider
    # The silence between two lines of a chapter (decided 2026-09-29): ONE value
    # for Studio's Render, the export and ACX QC, so what you audition is what
    # ships. Until then Render used 250 ms and export/QC a hardcoded 600. A
    # line's own pause (an import's pause_after_ms) still overrides it.
    pause_between_lines_ms: int = 600  # 0-3000 in the UI
    # The silence after a line that ends one of the book's scenes, inside a chapter
    # (decided 2026-10-06) — a JustWrite chapter keeps its scenes as runs of lines
    # (line_takes.scene_ends). Joins lines only: never in a line's delivery, so
    # changing it renders nothing again. A line's own pause still wins.
    pause_at_scene_break_ms: int = 2000  # 0-6000 in the UI
    # The silence between two lines cut from one paragraph — a quote, its dialogue tag,
    # the quote's rest (decided 2026-10-07). Joins lines only, like the scene break; a
    # line's own pause still wins.
    pause_within_paragraph_ms: int = 250  # 0-3000 in the UI
    # The language a voice speaks when nothing else decides it — today, a Kokoro
    # blend of voices in different languages (engines/blending.blend_language).
    # BCP-47. Lived under `training` until training was removed (2026-10-02).
    default_voice_language: str = "en-US"
    normalize_audio: bool = True


class CorsSettings(BaseModel):
    # The bundled UI runs from a different origin than the loopback server
    # (dev: http://localhost:1430 ; packaged Tauri webview: tauri://localhost
    # or http://tauri.localhost). Browsers enforce CORS on fetch() to the
    # server, so these must be allowed or the GUI sees empty responses.
    # Operator-tunable via PATCH /v1/settings.
    origins: list[str] = [
        "http://localhost:1430",
        "http://127.0.0.1:1430",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    # Regex fallback so arbitrary loopback dev ports (and the tauri scheme)
    # work without re-listing each one. Empty string disables it.
    origin_regex: str = (
        r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?"
        r"|tauri://localhost|https?://tauri\.localhost)$"
    )


class AuthSettings(BaseModel):
    tokens: list[str] = []
    require_for_loopback: bool = False


class MasterPreset(BaseModel):
    loudness_target_lufs: float
    true_peak_dbfs: float
    loudness_range_lu: float
    sample_rate: int
    channels: int
    format: str
    bitrate_kbps: int
    head_silence_secs: float
    tail_silence_secs: float


class MasterPresetSettings(BaseModel):
    # ACX spec: -23 to -18 LUFS, true peak <= -3 dB, noise floor <= -60 dB RMS,
    # 44.1 kHz / 16-bit / mono / MP3 192 kbps CBR for retail audio. We center
    # LUFS at -20 (safely inside -23/-18) and add 0.5 dB peak headroom (-3.5)
    # so production variance doesn't push peaks over the ACX limit.
    acx: MasterPreset = MasterPreset(
        loudness_target_lufs=-20.0,
        true_peak_dbfs=-3.5,
        loudness_range_lu=7.0,
        sample_rate=44_100,
        channels=1,
        format="mp3",
        bitrate_kbps=192,
        head_silence_secs=0.75,
        tail_silence_secs=3.0,
    )
    inaudio: MasterPreset = MasterPreset(
        loudness_target_lufs=-19.0,
        true_peak_dbfs=-3.0,
        loudness_range_lu=7.0,
        sample_rate=44_100,
        channels=1,
        format="mp3",
        bitrate_kbps=192,
        head_silence_secs=0.75,
        tail_silence_secs=3.0,
    )
    podcast: MasterPreset = MasterPreset(
        loudness_target_lufs=-16.0,
        true_peak_dbfs=-1.0,
        loudness_range_lu=10.0,
        sample_rate=44_100,
        channels=2,
        format="mp3",
        bitrate_kbps=128,
        head_silence_secs=0.5,
        tail_silence_secs=1.0,
    )
    youtube: MasterPreset = MasterPreset(
        loudness_target_lufs=-14.0,
        true_peak_dbfs=-1.0,
        loudness_range_lu=11.0,
        sample_rate=48_000,
        channels=2,
        format="mp3",
        bitrate_kbps=192,
        head_silence_secs=0.5,
        tail_silence_secs=1.0,
    )


class EngineModelSourceOverride(BaseModel):
    """Operator-provided source for one engine model variant.

    Per CLAUDE.md "no hardcoded operator-tunable values": engine model
    HF repos live in each engine's manifest VARIANTS as defaults, but the
    operator can point a variant at another repo (a mirror, a fork) here
    without editing code. The variant's pinned file names are kept
    (`engine_sources_api.resolve_source`).
    """

    hf_repo: str | None = None
    hf_revision: str | None = None   # pin a commit / tag


class EngineOverrides(BaseModel):
    """Per-engine operator overrides (download sources, keyed by variant id
    in `sources`, and the default model). EnginesSettings.engine_overrides
    maps engine_id -> EngineOverrides."""

    sources: dict[str, EngineModelSourceOverride] = {}
    # The operator's own default MODEL for this engine (parity batch
    # 2026-08-06 — the Speech-engines page's "Default ✓" row action). A USER
    # layer over the manifest's DEFAULT_VARIANT_ID: the manager's
    # _resolved_default_variant consults this first, so a no-variant load
    # actually loads it (never just relabels a row). None = manifest default.
    default_variant: str | None = None
    # Where each of this engine's models runs — variant id → "auto" | "gpu" | "cpu"
    # (CPU placement, 2026-10-02; docs/plans/2026-10-02-cpu-placement.md §8). A
    # variant not listed is "auto": the manager's rule picks from what it measured.
    # (The per-engine `device` choice that left with the per-engine environments on
    # 2026-10-01 was one setting for every model; this is per model.)
    placements: dict[str, Literal["auto", "gpu", "cpu"]] = {}
    # The longest piece a line reaches each model in — variant id → characters (audit
    # 2026-10-04 §13.3). A variant not listed uses its catalog default (`split_chars` on the
    # manifest row), and none at all = `generation.max_chunk_chars`. Bounds the model's working
    # memory, which grows with the line; the price a load is checked against is measured at it.
    split_chars: dict[str, int] = {}
    # The speech runtime's per-model options the user set — variant id → {option: value}, only
    # values other than the default (audit 2026-10-04 §13.5; what is offered and why:
    # `engines/audiocpp/runtime_options.py`). Passed as session options when the model loads.
    runtime_options: dict[str, dict[str, str]] = {}
    # When the user accepted the engine's own terms (the manifest's TERMS — Pocket
    # TTS: Kyutai's prohibited-use terms, which gate cloning). ISO-8601; None = not
    # accepted, and the gated use is refused.
    terms_accepted_at: str | None = None


class SpeechRuntimeSettings(BaseModel):
    """The ONE audio.cpp runtime every speech engine shares (the 2026-10-01 switch,
    docs/plans/2026-10-01-audiocpp-switch.md §3.1). Set on the AI page's runtime row
    through PUT /v1/speech-runtime, which also stops the server so the next load starts
    the new build."""

    # "auto" = this machine's choice (CUDA on NVIDIA, Vulkan on AMD/Intel, Metal on a
    # Mac); "cuda" | "vulkan" | "cpu" | "metal" pins that build. A pinned build that is
    # not installed reads as "not installed" until its Install runs.
    backend: str = "auto"
    # Which GPU the server runs on (audio.cpp's `device` — 0 = the first).
    gpu: int = 0
    # The second, CPU-only process (CPU placement, 2026-10-02): how many threads it
    # computes with. 0 = this machine's physical core count — measured: Kokoro speaks
    # 2.28× real time at 4 threads and 3.15× at 8 on an 8-core Ryzen.
    cpu_threads: int = 0
    # "Fast enough on the CPU" for Auto: a model runs there only when it speaks at
    # least this many seconds of audio per second of work (decided 2026-10-02: 2×).
    cpu_min_realtime: float = 2.0
    # The graphics-card process's CPU threads — its work off the card (text, sampling).
    gpu_threads: int = 4
    # How long a process may take to come up before its start counts as failed.
    start_timeout_s: float = 60.0
    # How long one request may run — a line, a model load. A transcription gets at least
    # three times its recording's length on top (recognition runs ~2× real time on the CPU).
    request_timeout_s: float = 900.0


class ExternalEngineConfig(BaseModel):
    id: str
    name: str
    base_url: str = ""
    api_key: str | None = None
    model: str = ""
    voices: list[str] = []
    response_format: str = "wav"
    # Item 9 (2026-06-12): the user runs this server themselves
    # (localhost/LAN) — free, private, no install. Lists under the
    # LOCAL tab's kind section; voice badges show self-hosted instead
    # of online·metered. Auto-detected from the URL, user-overridable.
    self_hosted: bool = False
    # Phase 2 / Slice 5 — TTS provider type discriminator. Default
    # "openai-compat" matches the prior single-pattern behavior so
    # existing settings.engines.external entries keep working without
    # edits. New types: elevenlabs / speechify / speechmatics / openai-tts /
    # edge-tts (Edge TTS deferred — needs Tauri-side msedge-tts wiring).
    provider_type: str = "openai-compat"


class EnginesSettings(BaseModel):
    # Per-engine operator overrides — engine_id -> overrides. Today only
    # holds per-variant download sources; see EngineOverrides.
    engine_overrides: dict[str, EngineOverrides] = {}
    # Preferred TTS engine for create flows + first-render auto-setup
    # (user ask 2026-06-12: a default-engine setting instead of
    # whichever-engine-happens-to-be-first). Engine id, e.g. "kokoro".
    default_tts_engine: str = "kokoro"
    # The audio.cpp runtime's backend and GPU — one for every speech engine.
    speech_runtime: SpeechRuntimeSettings = SpeechRuntimeSettings()
    external: list[ExternalEngineConfig] = []
    # LEGACY LLM provider list — dormant since 2026-08-01 (providers live in
    # the shared DB store); the field STAYS because migrate_providers reads it
    # to upgrade old installs on every boot.
    llm: list[LLMProviderConfig] = []
    # `feature_pins` + `production_configs` (the pin-era routing residue) were
    # dropped with F1 Phase 2 (ruling 1's clean drop), same pattern as
    # `llm_roles` before them: a stored settings tree still carrying the keys
    # is harmless — pydantic ignores unknown fields on load and the next save
    # writes the model without them. Routing lives on the shared presets.


class ModelsSettings(BaseModel):
    url_overrides: dict[str, str] = {}


UseCase = Literal[
    "audiobook",
    "game",
    "podcast",
    "dictation",
    "accessibility",
    "multiple",
    "unset",
]


class CapturesSettings(BaseModel):
    """Dictation capture + refinement defaults (upstream parity:
    voicebox's capture_settings singleton, kept in settings.json per the
    no-DB-singletons rule). Hotkey/chord fields are consumed by the
    desktop shell; the server stores them so every window + CLI client
    reads the same preferences."""

    stt_model: str = "qwen3-asr-1.7b-q8"  # variant id on the asr engine (engines/asr)
    language: str = "auto"
    auto_refine: bool = True
    llm_model: str = "qwen3-llm-0.6b"  # variant id on the qwen3-llm engine
    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True
    # (allow_auto_paste and default_playback_voice went 2026-10-05 — nothing read
    # them; the MCP default voice is mcp.default_voice.)
    hotkey_enabled: bool = False
    chord_push_to_talk_keys: list[str] = ["ControlRight", "ShiftRight"]
    chord_toggle_to_talk_keys: list[str] = ["ControlRight", "ShiftRight", "Space"]


class MCPSettings(BaseModel):
    """MCP server (/mcp) behaviour. The default voice applies when an agent
    calls justvoice.speak with no voice/persona and no per-client binding."""

    default_voice: str | None = None


class ExtractionSettings(BaseModel):
    """Speaker-attribution routing (the Auto simplification, 2026-08-06).

    Production always runs Auto — no stored force exists. A per-run route
    override (a route card's Lab run / the API `route` field) wins over
    Auto for that run only.
    `direct_min_b` — the editable size rule, Auto's ONLY rule since the
    tier-debris cleanup (2026-08-07: the thinking rule died with the
    Reasoned route): Direct when the model is at least this many billion
    parameters, otherwise Guided; unknown sizes play safe with Guided; a
    MoE counts TOTAL params. Stale keys from the retired force pills
    (`route`) and dial (`reading_style`) are ignored on load; the next
    settings save rewrites the canonical shape without them.
    The API floor (Part 7 rider, 2026-08-06) mirrors the pane input's
    min=0.1 — zero or a negative would route EVERY model to Direct."""

    direct_min_b: float = Field(default=14.0, ge=0.1)
    # Chapter splitting (2026-09-28, docs/plans/2026-09-28-chapter-splitting.md):
    # a chapter too long for the model is read in pieces. `split_lead_in_paragraphs`
    # — paragraphs of the piece before sent again for context (their lines are
    # answered by the earlier piece). `answer_tokens_per_line` — the room reserved
    # for the model's answer, per dialogue line (measured 45-65 with thinking on).
    split_lead_in_paragraphs: int = Field(default=6, ge=0)
    answer_tokens_per_line: int = Field(default=65, ge=1)
    # The second look (2026-10-05, extraction/second_look.py): after the main
    # call, each spoken line left with no speaker is asked about once more, with
    # the words around it and the neighbouring chapters' edges. Off by default
    # since 2026-10-06: Analyze does its main pass only, and the blank lines wait
    # for Script's 🔎 Second look (TASKS "Analyze leaves the second look to you").
    second_look: bool = False
    second_look_words: int = Field(default=1500, ge=50)     # either side of the line
    second_look_before: int = Field(default=800, ge=0)      # the end of the chapter before
    second_look_after: int = Field(default=1500, ge=0)      # the start of the chapter after


class AppSettings(BaseModel):
    """First-run onboarding + cross-cutting UI preferences.

    These live alongside the operator/runtime settings but drive
    terminology, default tab, and featured docs across the renderer
    rather than server behaviour.
    """

    primary_use_case: UseCase = "unset"
    secondary_use_cases: list[UseCase] = []
    onboarding_shown: bool = False


class Settings(BaseModel):
    server: ServerSettings = ServerSettings()
    logging: LoggingSettings = LoggingSettings()
    cache: CacheSettings = CacheSettings()
    limits: LimitsSettings = LimitsSettings()
    cors: CorsSettings = CorsSettings()
    auth: AuthSettings = AuthSettings()
    mastering: MasterPresetSettings = MasterPresetSettings()
    models: ModelsSettings = ModelsSettings()
    engines: EnginesSettings = EnginesSettings()
    generation: GenerationSettings = GenerationSettings()
    captures: CapturesSettings = CapturesSettings()
    mcp: MCPSettings = MCPSettings()
    extraction: ExtractionSettings = ExtractionSettings()
    app: AppSettings = AppSettings()


class SettingsPatch(BaseModel):
    """Partial-update shape; every field optional. Mirrors Settings."""

    server: ServerSettings | None = None
    logging: LoggingSettings | None = None
    cache: CacheSettings | None = None
    limits: LimitsSettings | None = None
    cors: CorsSettings | None = None
    auth: AuthSettings | None = None
    mastering: MasterPresetSettings | None = None
    models: ModelsSettings | None = None
    engines: EnginesSettings | None = None
    generation: GenerationSettings | None = None
    captures: CapturesSettings | None = None
    mcp: MCPSettings | None = None
    extraction: ExtractionSettings | None = None
    app: AppSettings | None = None


class SettingsPatchResponse(BaseModel):
    settings: Settings
    restart_required: list[str] = []


# ─── Voices ─────────────────────────────────────────────────────────────


# ("lora" — a trained voice — left with training on 2026-10-02, no alias: a
# stored voice still carrying it is unreadable by design.)
VoiceSource = Literal["preset", "cloned", "designed", "imported", "blended"]
StoredVoiceSource = Literal["cloned", "designed", "imported", "blended"]


# How a blended voice was made. Four strategies, three of which are weighted
# combinations of whole vectors and one of which is not (2026-08-21):
#
#   blend       Σ(wⱼ·vⱼ)/Σw — a mix. Weights are shares, so it normalizes.
#   extrapolate mean + k·(v − mean) — one voice pushed away from the pack's
#               average voice. Rearranges to k·v + (1−k)·mean, so it rides
#               the same weighted path with blending.MEAN_SOURCE as a source.
#   vector      A + B − C, the word2vec analogy. Does NOT normalize: the
#               magnitude is the answer, and dividing by Σw shrinks it.
#   recombine   contiguous slices of the feature axis taken from different
#               voices — nothing is averaged. Carries `segments`, not weights.
BlendStrategy = Literal["blend", "extrapolate", "vector", "recombine"]


class BlendSegment(BaseModel):
    """One slice of the style vector's feature axis, as fractions of it.

    Kokoro inherits StyleTTS2's split: the first half of the 256-wide
    reference vector conditions the decoder (timbre), the second half the
    prosody predictor. So (0.0, 0.5) and (0.5, 1.0) are "this voice's
    timbre" and "that voice's prosody" — which is why the UI names them.
    """

    voice_id: str
    start: float = 0.0
    end: float = 1.0


class BlendRecipe(BaseModel):
    # slerp/lerp retired 2026-08-19 with the kokoro-onnx swap. `strategy`
    # arrived 2026-08-21; it is stored, not derived, because two strategies
    # can produce the same numbers from the same sources and the recipe is
    # how a voice explains itself later.
    strategy: BlendStrategy = "blend"
    sources: list[str] = Field(default_factory=list)
    weights: list[float] = Field(default_factory=list)
    # recombine only; None for every weighted strategy.
    segments: list[BlendSegment] | None = None


class VoiceRecord(BaseModel):
    id: str
    engine: str
    # The model this voice was made for — the capability row id, e.g.
    # "chatterbox-turbo" (2026-10-03). A voice saved before models were
    # stored has none; `voice_model.model_for_stored` answers for it.
    model: str | None = None
    source: StoredVoiceSource
    name: str
    language: str
    gender: str | None = None
    design_prompt: str | None = None
    transcript: str | None = None
    # Qwen3 Base: clone from the speaker vector alone ("Skip the words"), kept so the voice's
    # renders take the mode its audition did (decided 2026-10-03).
    xvector_only: bool = False
    sample_count: int = 0
    blend_recipe: BlendRecipe | None = None
    embedding: list[float] | None = None
    created_at: datetime
    updated_at: datetime


class Voice(BaseModel):
    id: str
    engine: str
    source: VoiceSource
    name: str
    language: str
    gender: str = ""
    sample_url: str | None = None
    # What speaks it, from `voice_model` — one server answer for every screen
    # (2026-10-03): the model (capability row id) and its name, how it can be
    # directed ("words" · "tags" · "sliders"), and the languages it can be
    # spoken in on that model (one entry = fixed by the voice or the model).
    model: str = ""
    model_name: str = ""
    directed_by: str = ""
    speaks: list[str] = []
    # A designed voice's description — what it speaks from (no clip) or was
    # designed from (a kept take). The persona page's "Start from this one"
    # copies it into a new design (2026-10-04); Voices' gender guess reads it.
    design_prompt: str | None = None


class ClipCheckRequest(BaseModel):
    """POST /v1/voices/clip-check — a clip about to be cloned, decoded to WAV
    by the page (it reads every format the drop box takes)."""

    wav_b64: str


class ClipCheckResponse(BaseModel):
    """How long the clip is, and how far its speech stands above its noise
    in dB (None when the clip is too short or silent to tell). The persona
    page warns under 10 s, over 2 minutes, and under 25 dB (2026-10-04)."""

    seconds: float
    noise_margin_db: float | None = None


class VoiceList(BaseModel):
    voices: list[Voice]


class UpdateVoiceRequest(BaseModel):
    """PATCH /v1/voices/{id} — partial update of a stored voice's metadata.

    Only metadata fields; audio/embedding fields are managed by their own
    endpoints. None means "leave unchanged".
    """

    name: str | None = None
    language: str | None = None
    gender: str | None = None


class CloneVoiceRequest(BaseModel):
    engine: str
    # The model the clone is made for (capability row id); left out = the
    # engine's default model that can clone.
    model: str | None = None
    name: str
    ref_wav_b64: str
    language: str = "en-US"
    gender: str | None = None
    transcript: str | None = None
    xvector_only: bool = False   # Qwen3 Base's "Skip the words"


class DesignVoiceRequest(BaseModel):
    engine: str
    model: str | None = None
    name: str
    prompt: str
    language: str = "en-US"
    gender: str | None = None


class CopyVoiceRequest(BaseModel):
    """POST /v1/voices/{id}/copy — the same clip as a new voice on another
    model ("Copy to another model…", 2026-10-03): Marius on Turbo in English,
    and again on Chatterbox Multilingual for Spanish."""

    model: str
    name: str | None = None
    # Qwen3 Base clones from the clip's words or from the speaker vector
    # alone; a copy may supply either when the source voice has neither.
    transcript: str | None = None
    xvector_only: bool | None = None


# ─── Personas ───────────────────────────────────────────────────────────


class PersonaModelSettings(BaseModel):
    """What a persona sets that only one MODEL understands (2026-10-03) —
    kept per model, so switching a persona to another model and back
    restores them, and Turbo's top-k never lands on Qwen3 (plan §6.2 Q5).

    `emotion` is in the model's own vocabulary: one of the app's nine
    (`Emotion`) on a model that takes written direction, or one of the
    model's emotion TAGS on a tag model (Chatterbox Turbo / Nano's seven).
    `register_tag` is a tag model's register (Turbo's narration / dramatic /
    advertisement; "register" itself is taken by pydantic). Both are put at the start of every line the persona
    speaks; a line overrides them (Studio Render, Slice 4).
    """

    model_config = ConfigDict(extra="forbid")

    # The model's own sampling knobs, keyed as its capability row names them
    # (talker_temperature, exaggeration, top_k, cfg_value …).
    knobs: dict[str, float] = {}
    seed: int | None = None
    emotion: str | None = None
    register_tag: str | None = None


class PersonaDelivery(BaseModel):
    """How a persona speaks, on top of its voice (2026-10-03, plan §6.1).

    Pace, pitch, gain and the pauses are done on the server, so every model
    takes them and they survive a change of voice or model. Everything a
    model understands only for itself lives under `models[<model id>]`.
    Extra keys from before this shape are ignored on read (no migrations —
    the editor never wrote any)."""

    model_config = ConfigDict(extra="ignore")

    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    pitch: float | None = Field(default=None, ge=-12.0, le=12.0)
    gain_db: float | None = Field(default=None, ge=-12.0, le=12.0)
    pause_before: int | None = Field(default=None, ge=0, le=10000)
    pause_after: int | None = Field(default=None, ge=0, le=10000)
    models: dict[str, PersonaModelSettings] = {}


class Persona(BaseModel):
    """A finished spoken voice — the library's unit (2026-09-29 split). It
    plays speakers; who a person in a book IS lives on the `Speaker`."""

    id: str
    name: str
    # Optional — a persona can be saved before its voice is picked; a speaker
    # it plays can't render until it has one. Was required, which 422'd
    # persona creation with an empty voice library (user-hit 2026-06-12).
    voice_id: str | None = None
    language: str = "en"
    avatar_path: str | None = None
    # Spoken-delivery instruction — the ONE field that changes the audio.
    # Engines whose manifest declares `instruct_field` consume it as the
    # `instruct` / style-prompt field at render time; engines that don't
    # accept it ignore it. **Never an LLM rewrite of the manuscript** —
    # Rewrite is a separate explicit tool.
    voice_instruct: str | None = None
    # A short note on how it sounds. Read by Compose / Rewrite on the persona page and
    # by Smart-assign; never by an engine — that is `voice_instruct`'s job.
    note: str | None = None
    # How it speaks — pace, pitch, gain, pauses, and per model its emotion,
    # register, sampling knobs and seed (`PersonaDelivery`). A request's own
    # delivery sits on top. (The persona's engine override was read by
    # nothing and left 2026-10-03: the model comes from the voice.)
    default_delivery: PersonaDelivery = PersonaDelivery()
    # Effects chain — applied after TTS produces WAV (see audio/dsp/). List
    # of {type, params} dicts; runs on every line this persona speaks.
    effects_chain: list[dict[str, Any]] = []
    lexicon_id: str | None = None
    # Legacy rewrite-toggle fields. Kept on disk for backwards-compatibility
    # with existing persona JSON files. The actual Rewrite affordance becomes
    # an explicit button on Generate / Studio Script tab (Slice 3) — these
    # flags will be dropped in Slice 4 after the UI is migrated.
    llm_rewrite_enabled: bool = False
    llm_model: str | None = None
    imported_from: str | None = None
    imported_id: str | None = None
    created_at: datetime
    updated_at: datetime


class PersonaView(Persona):
    """A persona as the API shows it: the stored persona plus what its voice
    makes of it (2026-10-03, the persona redesign) — the model that speaks it,
    that model's name, how it can be directed (`words` · `tags` · `sliders`)
    and the language the persona actually speaks. Read-only; one answer for
    the Personas list, Cast and the persona's page."""

    model: str | None = None
    model_name: str | None = None
    directed_by: str | None = None
    speaks: str | None = None


class PersonaList(BaseModel):
    personas: list[PersonaView]


class CreatePersonaRequest(BaseModel):
    name: str
    voice_id: str | None = None
    # Left out = the voice's own language (or "en" with no voice yet).
    language: str | None = None
    avatar_path: str | None = None
    voice_instruct: str | None = None
    note: str | None = None
    default_delivery: PersonaDelivery = PersonaDelivery()
    effects_chain: list[dict[str, Any]] = []
    lexicon_id: str | None = None
    # Legacy — see Persona model
    llm_rewrite_enabled: bool = False
    llm_model: str | None = None


class UpdatePersonaRequest(BaseModel):
    """PATCH /v1/personas/{id} — a field left out is unchanged; a field sent
    as null is CLEARED (2026-10-03). Until then the only update was a PUT
    whose store skipped None, so emptying Spoken delivery, the note or the
    lexicon kept the old value while the page said "Persona saved"."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    voice_id: str | None = None
    language: str | None = None
    avatar_path: str | None = None
    voice_instruct: str | None = None
    note: str | None = None
    default_delivery: PersonaDelivery | None = None
    effects_chain: list[dict[str, Any]] | None = None
    lexicon_id: str | None = None


class PersonaDraft(BaseModel):
    """A persona as the editor holds it, saved or not — what a Listen
    renders. Every field optional: a draft with no name can still be heard."""

    name: str = ""
    voice_id: str | None = None
    language: str | None = None
    voice_instruct: str | None = None
    default_delivery: PersonaDelivery = PersonaDelivery()
    effects_chain: list[dict[str, Any]] = []
    lexicon_id: str | None = None


class PersonaPreviewRequest(BaseModel):
    """POST /v1/personas/preview — hear a persona speak a line, through the
    same resolver a chapter renders with. Send `persona` (the editor's
    unsaved draft) or `persona_id` (a saved one: Cast's ▶, the index ▶)."""

    persona_id: str | None = None
    persona: PersonaDraft | None = None
    text: str = Field(default="", max_length=2000)
    # A line's own direction, as a chapter line would carry it (Compare).
    direction: str | None = None
    # One-off delivery on top of the persona's (Compare settings: a knob's
    # three values). Same shape as a line override in Slice 4.
    delivery: dict[str, Any] | None = None
    # False: refuse with `engine_not_loaded:<engine>` instead of loading the
    # voice's model, so a ▶ in a list can ask first (the voice ▶'s contract).
    # The editor's Listen loads — its page already says the first listen will.
    auto_load: bool = True


class MergePersonaRequest(BaseModel):
    """POST /v1/personas/{id}/merge — "Merge into…" (decided 2026-10-03):
    every speaker this persona plays moves to `into`, then this one goes."""

    into: str


# ─── Speakers — the people in one book ──────────────────────────────────


# A speaker's pronouns (persona build P9, 2026-10-04) — read by Script's Analyze and
# Smart-assign, never heard. Not set = None.
Pronouns = Literal["he/him", "she/her", "they/them", "it/its"]


class Speaker(BaseModel):
    """A person in one book (2026-09-29). The book's cast is its speakers;
    Cast gives each a persona. `lines` counts the lines they read."""

    id: str
    project_id: str
    name: str
    # "Also called" — the other names the text uses.
    aliases: list[str] = []
    # "Who they are" — read by the AI, never heard.
    description: str | None = None
    # The persona that plays them; null = not cast yet.
    persona_id: str | None = None
    persona_name: str | None = None
    # "narrator" for the book's narrator.
    role_label: str | None = None
    pronouns: Pronouns | None = None
    lines: int = 0
    # Where the speaker came from (2026-10-06): the import that brought them
    # ("justwrite" — the book's own characters); null = added here (Discover's
    # ＋ Add, the narrator). Discover and Cast show it as From the book / Added here.
    imported_from: str | None = None


class SpeakerList(BaseModel):
    speakers: list[Speaker]


class CreateSpeakerRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    aliases: list[str] = []
    description: str | None = None
    # Left out = cast by an exact persona name when one exists (every new
    # speaker, decided 2026-09-29).
    persona_id: str | None = None
    pronouns: Pronouns | None = None


class UpdateSpeakerRequest(BaseModel):
    """Left out = unchanged. `persona_id` sent as null = un-cast; `pronouns` sent as null =
    not set."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    aliases: list[str] | None = None
    description: str | None = None
    persona_id: str | None = None
    pronouns: Pronouns | None = None


# ─── Lexicons ───────────────────────────────────────────────────────────


class LexiconEntry(BaseModel):
    grapheme: str
    phoneme_ipa: str | None = None
    alias: str | None = None


class Lexicon(BaseModel):
    id: str
    name: str
    entries: list[LexiconEntry] = []
    # Scope discriminator — drives the badge in LexiconsView. "global" =
    # reusable across projects; "project" = book-scoped (set project_id);
    # "persona" = persona-scoped (set persona_id).
    scope: str = "global"
    description: str | None = None
    project_id: str | None = None
    persona_id: str | None = None
    created_at: datetime
    updated_at: datetime


class LexiconList(BaseModel):
    lexicons: list[Lexicon]


class CreateLexiconRequest(BaseModel):
    name: str
    entries: list[LexiconEntry] = []
    scope: str = "global"
    description: str | None = None
    project_id: str | None = None
    persona_id: str | None = None


# ─── Engines / catalog ─────────────────────────────────────────────────


EngineStatus = Literal["not_installed", "installing", "installed", "loading", "loaded"]

Feature = Literal[
    "preset_voices",
    "voice_cloning",
    "voice_design",
    "instruct_field",
    "paralinguistic_tags",
    "phoneme_override",
    "gpu_accel",
    "single_speaker_dialogue",
    "voice_blending",
]


class Prerequisites(BaseModel):
    rust_feature: str | None = None
    rust_native: bool = False
    sidecar: bool = False
    model_files_needed: list[str] = []
    gpu_runtimes: list[str] = []


class EngineInfo(BaseModel):
    id: str
    name: str
    description: str
    backend: str
    # Runtime-registered providers the user hosts themselves (item 9) —
    # drives LOCAL-tab placement + self-hosted voice badges.
    self_hosted: bool = False
    capabilities: list[Feature] = []
    prerequisites: Prerequisites = Prerequisites()
    status: EngineStatus = "not_installed"
    current: bool = False
    is_stubbed: bool = False
    # When the engine has multiple model variants in `/v1/engines/<id>/models`,
    # this is the id of the one `POST /v1/engines/<id>/load` (with no
    # `model_variant` arg) actually loads. The GUI uses it to (a) label
    # the default model in the variants subtable and (b) hide that variant
    # from the per-variant Load list so the user isn't offered two routes
    # to the same checkpoint.
    default_variant_id: str | None = None
    # Phase 2 / Slice 1 — engine discriminator (tts / llm / embedding).
    # EngineManager keeps one slot loaded per kind so an LLM and a TTS
    # engine can be resident simultaneously (required for speaker
    # attribution + render in the same flow).
    kind: str = "tts"
    # Engines redesign: full capability list (manifest KINDS, falling back
    # to [KIND]). `kind` stays = kinds[0] for back-compat consumers.
    kinds: list[str] = []
    # Phase 2 / Slice 1 — the actual variant currently loaded for this
    # engine (server-truth, not local-state). null when the engine isn't
    # loaded. The dropdown UI uses this to label "Loaded: <variant>"
    # correctly across page refreshes.
    current_variant_id: str | None = None
    # "audiocpp" since 2026-10-01: the engine's models run in the ONE audio.cpp
    # runtime (no environment of its own — installing any engine installs the
    # runtime). Until then "venv": each engine its own Python environment.
    # External (in-process) providers carry "" — they are not installed at all.
    isolation: str = ""
    # OSes this engine works on, straight from the manifest. Values:
    # "windows" | "linux" | "macos". This comment used to say "UI hides
    # engines whose list doesn't include the user's current OS" — no UI ever
    # read the field (2026-08-17 audit).
    supported_oses: list[str] = []
    # The verdict, computed server-side: is THIS host's OS in that list? The
    # client should never re-derive it — the server knows its own platform and
    # the renderer may be a browser on a different machine entirely. False
    # means `install_engine` will refuse, so the UI shows why instead of
    # offering an Install button that raises.
    supported_on_this_os: bool = True
    # Non-empty = marked for removal; the string is the reason, shown to the
    # user. An already-installed deprecated engine keeps working and keeps its
    # row (badged); an uninstalled one is hidden from the catalog and never
    # offered by Voice engine setup. Set by the manifest's DEPRECATED.
    deprecated: str = ""
    # Model-weights license — distinct from framework code license. Common
    # values: "Apache-2.0", "MIT". Set per engine manifest
    # (`WEIGHTS_LICENSE = "..."`). Surfaced in the Engines tab so users selling
    # produced audio know the terms. (The `attribution` field beside it left
    # with TADA on 2026-10-01 — its "Built with Llama" was the only producer.)
    weights_license: str = ""
    # Where the last confirmed load actually runs — the speech runtime's
    # backend ("cuda", "vulkan", "cpu", "metal"; the 2026-08-13 VRAM wiring, Q2:
    # always visible, never hidden). null = not loaded this server process.
    resolved_device: str | None = None
    # Why the loaded model runs there, in the user's words ("CPU — 3.2× real time
    # measured here; keeps the graphics card for the AI model"). "" = not loaded.
    placement_reason: str = ""
    # The engine's own terms, when it has some (Pocket TTS: Kyutai's prohibited-use
    # terms, which gate cloning) — {title, text, url, gates}; None = no terms.
    terms: dict[str, str] | None = None
    terms_accepted: bool = False


class EnginesListResponse(BaseModel):
    engines: list[EngineInfo]
    current: str | None = None


# ─── The memory budget strip (the 2026-08-13 VRAM wiring, Q3/Q4) ─────────


class VramReservation(BaseModel):
    """One resident booking in the shared ledger. `source` is §13.1 provenance
    (measured | computed | declared) — a manifest-priced TTS row must never
    read as live truth on the strip."""

    key: str
    vram_mb: int
    pinned: bool = False
    kind: str = "llm"
    source: str = "computed"
    # ASLEEP (2026-08-15): the AI runner idle-unloaded this model, so the booking
    # names memory the card is not currently holding — it is what the model takes
    # back when it next answers. Excluded from `committed_mb`; shown as "asleep"
    # rather than a live number, so the strip never reports two truths at once.
    asleep: bool = False
    # Engine display name, joined server-side (the 2026-08-15 one-strip
    # consolidation: the strip's cells render without the engines list).
    label: str = ""


class VramLoadedRow(BaseModel):
    """One LOADED speech engine, pre-joined for the strip's cells (the
    2026-08-15 one-strip consolidation): kind + engine display name + the
    loaded model's display name + the resolved device. A loaded engine with
    no reservation row is the strip's "not measured yet" cell."""

    key: str  # "tts:chatterbox"
    kind: str
    label: str
    model: str = ""
    device: str = ""


class VramClaim(BaseModel):
    """The on-demand LLM's predicted footprint (Q3's standing line), resolved
    by the kit's four-arm claim resolver (resident-live → measured → computed
    → declared). `ram_mb` is display-only (§8.18)."""

    model: str
    vram_mb: int
    ram_mb: int = 0
    source: str = "computed"
    matches: int = 0


class VramEvent(BaseModel):
    """One eviction from the arbiter's event ring (Q3: event-driven honesty —
    toasts name what was evicted and why, no predictive warnings)."""

    seq: int
    at: int
    victim_key: str
    victim_kind: str
    reason: str = ""


class LeftoverEngine(BaseModel):
    """One engine process tree whose server is gone (2026-09-29)."""

    pid: int
    engine_id: str
    engine_name: str
    started: float                  # epoch seconds
    server_pid: int | None = None   # the server that started it, when known
    gpu_mb: int | None = None       # None = unmeasurable on this box


class LeftoverEnginesResponse(BaseModel):
    """`GET /v1/engines/leftovers` (what is left over) and
    `POST /v1/engines/leftovers/stop` (what was stopped)."""

    leftovers: list[LeftoverEngine]
    gpu_mb: int | None = None       # summed; None when nothing could be measured


class EngineVramResponse(BaseModel):
    """`GET /v1/engines/vram` — the one budget view (Q4): the arch-aware
    arbiter snapshot + the on-demand claim + eviction events. `mem_arch`
    drives the strip's label: "VRAM" on discrete boxes, "Memory" on one-pool
    (integrated/unified) boxes."""

    mem_arch: str
    total_mb: int
    committed_mb: int
    # Booked INCLUDING models the AI runner has put to sleep (2026-08-15).
    # `committed_mb` is what is held right now; this is what would be held once
    # every sleeper woke — the difference is the memory a wake will reclaim.
    booked_mb: int = 0
    remaining_mb: int
    # The 2026-08-13 redesign: the MEASURED pool state — `used_mb` is what
    # nvidia-smi would print (None = unmeasurable box), `other_mb` the slice
    # of it the ledger can't attribute (other apps, OS). The strip displays
    # these; committed/remaining stay for admission introspection.
    used_mb: int | None = None
    other_mb: int = 0
    reservations: list[VramReservation] = []
    # Loaded speech engines pre-joined with their model names (2026-08-15:
    # the one-strip cells need "TTS — Chatterbox Turbo · 3.1 GB" without a
    # second client-side fetch of the engines list).
    loaded: list[VramLoadedRow] = []
    busy_kinds: list[str] = []
    claim: VramClaim | None = None
    # Why there is no claim when claim is null: "cloud-routed" (no JV feature
    # resolves to the bundled runner) | "not-configured" | "unavailable".
    claim_reason: str | None = None
    events: list[VramEvent] = []


class CurrentEngineResponse(BaseModel):
    engine: EngineInfo | None = None


# ─── Engine capability detail (drives Generate UI gating) ───────────────
#
# The boolean Feature enum above answers "does engine X support cloning?"
# This richer set answers "what KNOB RANGES does engine X accept, what
# INLINE TAGS does its tokenizer parse, and where in the text do they
# need to go?" Driven by the per-engine verified-from-upstream research
# captured in memory/reference_engine_capability_surface.md. Used by the
# The persona page's Hear it + the paralinguistic slash menu.


class KnobSpec(BaseModel):
    """A continuous-value control (slider + number input)."""

    key: str  # e.g. "temperature" / "exaggeration" / "cfg_weight" / "speed"
    label: str
    min: float
    max: float
    step: float
    default: float
    unit: str = ""  # display suffix, e.g. "×" / "st" / "dB"
    hint: str = ""
    advanced: bool = False  # hide behind a Show-advanced toggle


class InlineTagSet(BaseModel):
    """A category of inline tags this engine's tokenizer recognizes.

    Drives the slash menu in Generate / Chapter textareas. Different engines
    use different syntaxes — Chatterbox-Turbo uses `[laugh]`, MOSS uses
    `[S1] [S2] [pause 1.5s]`.
    """

    category: str  # "emotion" | "register" | "style" | "prosody" | "sfx" | "paralinguistic" | "speaker" | "pause"
    label: str
    tags: list[str]
    syntax: str  # f-string with {value}, e.g. "<|emotion:{value}|>"
    placement: Literal["start_of_turn", "inline_anywhere"] = "inline_anywhere"
    hint: str = ""
    # Maps JustVoice's own `Delivery.emotion` values onto THIS engine's tag
    # values, for the one category that has a cross-engine equivalent. Only
    # `category="emotion"` sets carry it. Present = `render_core` compiles the
    # enum into a tag for this engine and the UI may offer the enum; absent =
    # the tags are engine-private and reachable only by typing them.
    #
    # An enum value missing from the map is NOT expressible here — the UI says
    # so rather than substituting a near-neighbour. Turbo has no token for
    # `shouted` or `contemptuous`, and `[crying]` is a behaviour rather than
    # `sad`'s state, so those three stay unmapped on purpose.
    value_map: dict[str, str] | None = None


class EngineCapabilityDetail(BaseModel):
    """Per-engine (or per-variant) capability surface for UI gating.

    The id may be either an engine_id or a model-variant id when a single
    engine has multiple variants with materially different parameter sets
    (e.g. chatterbox vs chatterbox-turbo — Turbo silently ignores
    exaggeration/cfg_weight/min_p).
    """

    engine_id: str
    display_name: str

    # Capability booleans (richer than the Feature enum — variant-aware)
    supports_voice_cloning: bool = False
    supports_clone_prompt_text: bool = False  # ref-audio transcript field
    supports_voice_design: bool = False  # qwen3-style description
    supports_instruct_freeform: bool = False  # qwen3-style prose textarea
    supports_phoneme_input: bool = False  # kokoro raw-IPA bypass
    # Clone from the speaker vector alone, skipping the reference
    # transcript: faster and needs no transcript, at lower fidelity
    # (Qwen3 Base's `x_vector_only_mode`).
    supports_xvector_only: bool = False
    supports_multi_speaker: bool = False  # MOSS speaker_prompts map
    supports_voice_blending: bool = False  # style-vector averaging (kokoro)

    # Numeric / continuous knobs (sliders)
    knobs: list[KnobSpec] = []

    # Inline-tag taxonomies (slash menu + capability hints)
    inline_tags: list[InlineTagSet] = []

    # Pitch — special-cased because it's the most-requested control even
    # though most engines lack it natively. Values:
    # - native_st_range: engine's own pitch range (only LuxTTS currently)
    # - post_process_available: server can pitch-shift the rendered WAV
    #   on the output regardless of engine support
    pitch_native_st_range: list[int] | None = None  # [min, max] semitones
    pitch_post_process: bool = False

    # Speed — true when the model paces itself (Kokoro, KittenTTS take a
    # speed). Every other engine renders at its own pace and the server
    # time-stretches the finished line (switch plan §5, gap 8).
    speed_native: bool = False

    # Free-form notes for the UI to display under the capability banner.
    notes: list[str] = []


class EngineCapabilitiesResponse(BaseModel):
    """`GET /v1/engines/capabilities` payload."""

    engines: dict[str, EngineCapabilityDetail]
    # The canonical `Delivery.emotion` vocabulary, served rather than
    # duplicated client-side so the picker can never drift from the enum.
    # Which of these an engine can actually express is per-engine: prose for
    # `supports_instruct_freeform`, a tag for an `inline_tags` set whose
    # category is "emotion" (see its `value_map`), nothing otherwise.
    emotion_values: list[str] = []


class ModelFile(BaseModel):
    url: str
    sha256: str
    target_path: str
    size_bytes: int


class RuntimeOptionChoice(BaseModel):
    value: str
    label: str


class RuntimeOption(BaseModel):
    """One of a model's speech-runtime options, as its row on Speech engines shows it."""

    key: str          # the runtime's session-option name, e.g. "qwen3_tts.perf_mode"
    label: str
    hint: str = ""
    default: str
    value: str        # what this model loads with
    choices: list[RuntimeOptionChoice] = []


class ModelVariant(BaseModel):
    # No vram_mb here (2026-08-14, the measured redesign): a variant's memory
    # footprint is MEASURED at load time, never declared in a catalog row.
    # size_mb is the DOWNLOAD size — the sum of the manifest's pinned real
    # file sizes (phase ②c), never hand-typed.
    id: str
    name: str
    description: str
    size_mb: int
    quality: int
    languages: list[str]
    # Per-variant capability facts (the §4 cloning-distinction ruling —
    # phase ③'s chips read these). None = the manifest doesn't say.
    voice_cloning: bool | None = None
    # Per-variant design fact — only qwen3-vd-1.7b carries it today; the
    # engine-level union would show a design tick on checkpoints that
    # cannot design (the same lie the cloning flag had).
    voice_design: bool | None = None
    preset_voices: int | None = None
    weights_license: str = ""
    # The primary source, for "View on Hugging Face" / provenance display.
    hf_repo: str | None = None
    url: str | None = None
    # Legacy field — the dormant non-managed install path reads it; managed
    # variants emit [] (the placeholder rows with fake URLs died in ②c).
    files: list[ModelFile] = []
    # Engines redesign: weights present locally (speech cache first, then a
    # legacy HF-cache install). None = unknown.
    on_disk: bool | None = None
    # Where those weights live when on_disk — the resolved folder (speech
    # cache / legacy HF cache / tarball models_dir), for the desktop
    # "Open folder" verb. The SERVER resolves it so the layout knowledge
    # stays in one place (speech_cache.py); None when nothing is local.
    local_dir: str | None = None
    # Where it runs (CPU placement, 2026-10-02). `placement` is the user's choice
    # ("auto" | "gpu" | "cpu"); `runs_on` is where it runs now when loaded, or where
    # a load would put it now ("gpu" | "cpu"), and `runs_on_reason` says why.
    placement: str = "auto"
    runs_on: str | None = None
    runs_on_reason: str = ""
    # Its speed on the CPU, seconds of audio per second of work: measured on this
    # machine when `cpu_realtime_here`, else the manifest's reference figure (a
    # Ryzen 7 5700X, 8 threads). None = never measured — the CPU is not offered by Auto.
    cpu_realtime: float | None = None
    cpu_realtime_here: bool = False
    # The speech runtime's options this model takes, with their values (empty = none offered).
    runtime_options: list[RuntimeOption] = []


class ModelsListResponse(BaseModel):
    engine_id: str
    variants: list[ModelVariant]


class InstallRequest(BaseModel):
    model_variant: str | None = None
    # Download the speech runtime (and eSpeak NG) again over the installed one — the runtime
    # row's Reinstall, for a build that won't start or a file an antivirus took. Without it an
    # install found the broken build "already there" and changed nothing (audit §5 E6).
    repair: bool = False


class InstallResponse(BaseModel):
    engine_id: str
    model_variant: str
    job_id: str


class LoadRequest(BaseModel):
    model_variant: str | None = None
    device: str = "auto"


class LoadResponse(BaseModel):
    engine_id: str
    device: str
    model_variant: str | None = None


class UnloadResponse(BaseModel):
    previous_engine: str | None = None


class UninstallResponse(BaseModel):
    engine_id: str
    model_files_removed: bool


# ─── Jobs (install progress) ────────────────────────────────────────────


# Free-form to keep room for engine-specific phases emitted by the manager
# (creating-venv, installing-plugin, downloading-model, extracting-model,
# torch, model-tarball, …). The GUI only cares about completed vs failed
# transitions plus showing the latest phase string in a progress label.
JobPhase = str


class JobStatus(BaseModel):
    job_id: str
    engine_id: str
    model_variant: str
    phase: JobPhase
    bytes_downloaded: int = 0
    bytes_total: int = 0
    current_file: str | None = None
    error: str | None = None
    # Rolling tail of pip / download output lines — capped at 400 entries so
    # a failed install can be debugged from the GUI without tailing the server
    # log. Each line is whatever the installer's `progress()` callback last
    # emitted (raw pip output, status updates, error tracebacks).
    log_tail: list[str] = []


# ─── External engine probe ─────────────────────────────────────────────


class ProbeRequest(BaseModel):
    base_url: str
    api_key: str | None = None


class ProbeResponse(BaseModel):
    reachable: bool
    models: list[str] = []
    voices: list[str] = []
    server_hint: Literal["kokoro-fastapi", "openai-edge-tts", "openai", "unknown"] = "unknown"
    recommended_model: str | None = None
    error: str | None = None


# ─── Delivery + generation ─────────────────────────────────────────────


Emotion = Literal[
    "neutral",
    "happy",
    "sad",
    "angry",
    "fearful",
    "whispered",
    "shouted",
    "sarcastic",
    "contemptuous",
]

# Derived, never typed twice: the capabilities endpoint serves this so the
# renderer's emotion picker and this enum cannot drift apart.
EMOTION_VALUES: list[str] = list(get_args(Emotion))


class Delivery(BaseModel):
    speed: float | None = None
    emotion: Emotion | None = None
    pitch: float | None = None
    pause_before: int | None = None
    pause_after: int | None = None
    gain_db: float | None = None
    instruct: str | None = None
    # `style_prompt` was a second prose field here until 2026-08-17 — meant as
    # "the consistent voice character" against instruct's "this line". It was
    # deleted because Qwen has exactly ONE upstream instruct slot and the
    # adapter concatenated the pair one line before the model saw them, so the
    # split never reached anything. The standing-vs-this-line axis it was
    # reaching for is the persona-vs-line axis, which the app already has:
    # `persona.voice_instruct` is standing, `Block.direction` is this line.
    # Sampling temperature. Engines that support it (Chatterbox,
    # Qwen3 talker) read `delivery.temperature` directly. Engines
    # that don't (Kokoro, etc.) ignore it.
    temperature: float | None = None
    # A tag model's own tags for the whole line (Chatterbox Turbo / Nano:
    # its emotion and register, e.g. ["fear", "dramatic"]) — put at the
    # start of the line by render_core, kept only where the model lists
    # them. The persona's, from PersonaModelSettings (2026-10-03).
    tags: list[str] | None = None
    # Per-render RNG seed. Top-level GenerateRequest.seed remains the
    # canonical field; this delivery-level seed is honored so the UI
    # can send a single Delivery object without splitting fields.
    # generate_api / render_core resolve precedence: delivery.seed
    # wins over req.seed (a deliberate override).
    seed: int | None = None
    engine: dict[str, Any] | None = None


class GenerateRequest(BaseModel):
    voice: str
    text: str
    language: str | None = None
    delivery: Delivery | None = None
    seed: int | None = None
    lexicons: list[str] = []
    cache_scope: str = "default"
    cache: bool = True
    # The persona's delivery, effects and lexicon ride under the request's.
    persona_id: str | None = None


class ChapterLine(BaseModel):
    voice: str
    text: str
    language: str | None = None
    delivery: Delivery | None = None
    seed: int | None = None
    # The effects chain for this line (its persona's). Scene mode fills it
    # from the block's persona; direct-mode callers may pass
    # one. Part of the render cache key — see render_core.render_line.
    effects: list[dict] | None = None
    # The lexicons this line is read with, in order (render_core.line_lexicons:
    # the book's, then its speaker's persona's). Scene mode fills it; a
    # request's own `lexicons` follow it on every line.
    lexicons: list[str] | None = None
    # Scene mode only: the line's block, so the chapter plays its ★ take when
    # it has one (Studio Slice 4, 2026-10-04). Direct-mode callers leave it out.
    block_id: str | None = None
    # Scene mode: the line ends one of the book's scenes, and has no pause of its
    # own — the chapter joins it to the next with Settings' pause at a scene break
    # (2026-10-06).
    scene_break_after: bool = False
    # Scene mode: the next line is from the same paragraph, and this line has no pause of
    # its own — joined with Settings' pause within a paragraph (2026-10-07).
    paragraph_next: bool = False


class BetweenLines(BaseModel):
    # None = Settings → generation.pause_between_lines_ms (2026-09-29); a caller
    # that sends a value still gets it.
    silence_ms: int | None = None


class RenderChapterRequest(BaseModel):
    # Direct mode: pass `lines[]` literally (the legacy path — JustWrite
    # adapter, single-chapter renders from CLI, etc.).
    # Scene mode: pass `scene_id`; the server resolves blocks → personas →
    # lines internally. `lines` may be omitted in scene mode.
    lines: list[ChapterLine] = []
    scene_id: str | None = None
    between_lines: BetweenLines = BetweenLines()
    master: Literal["acx", "inaudio", "podcast", "youtube", "none"] | None = None
    title: str | None = None
    author: str | None = None
    book: str | None = None
    cache_scope: str = "default"
    lexicons: list[str] = []


# ─── Phase 5 — blend ─────────────────────────────────────────────────


class BlendVoiceRequest(BaseModel):
    engine: str
    model: str | None = None
    name: str
    # Weighted strategies (blend / extrapolate / vector). One id may be
    # blending.MEAN_SOURCE, which resolves to the pack's average voice.
    source_voice_ids: list[str] = Field(default_factory=list)
    weights: list[float] | None = None
    strategy: BlendStrategy = "blend"
    # recombine only.
    segments: list[BlendSegment] | None = None


# ─── Cache ──────────────────────────────────────────────────────────────


class ScopeStats(BaseModel):
    entries_on_disk: int
    bytes_on_disk: int


class CacheStats(BaseModel):
    total_entries_on_disk: int
    total_bytes_on_disk: int
    memory_entries: int
    memory_bytes: int
    scopes: dict[str, ScopeStats] = {}


# ─── Errors (RFC 7807) ─────────────────────────────────────────────────


class ProblemDetails(BaseModel):
    type: str
    title: str
    status: int
    detail: str
    instance: str = ""


# ─── Audio analyzer ─────────────────────────────────────────────────────


class WavFormat(BaseModel):
    sample_rate: int
    channels: int
    bits_per_sample: int
    sample_count: int
    duration_sec: float


class LoudnessStats(BaseModel):
    peak_dbfs: float
    rms_dbfs: float
    crest_factor_db: float
    silence_ratio: float
    clipping_ratio: float


class AudioAnalysis(BaseModel):
    sha256: str
    file_size_bytes: int
    format: WavFormat
    loudness: LoudnessStats


class AnalyzeRequest(BaseModel):
    wav_b64: str


class CompareRequest(BaseModel):
    a_wav_b64: str
    b_wav_b64: str
    a_label: str | None = None
    b_label: str | None = None


class ComparisonReport(BaseModel):
    a: AudioAnalysis
    b: AudioAnalysis
    identical: bool
    format_match: bool
    peak_diff_db: float
    rms_diff_db: float
    duration_diff_sec: float
    sample_rmse: float | None = None
    max_sample_delta: float | None = None
    pct_identical_samples: float | None = None
    verdict: str
    a_label: str | None = None
    b_label: str | None = None

# ─── Script — who says each line (Studio Slice 3, §8.24) ─────────────────


class ScriptSpeaker(BaseModel):
    speaker_id: str
    name: str
    # Lines this speaker reads in the chapter.
    lines: int = 0


class ScriptChapter(BaseModel):
    """One row of Script's chapter grid. Counts are lines."""

    scene_id: str
    position: int
    title: str | None = None
    # Every line with text, narration included; 0 = no text yet.
    lines: int = 0
    spoken: int = 0
    # When Analyze last ran. Older data has none: `analyzed` is then read off
    # the lines (a pipeline `source`), with no date.
    analyzed_at: str | None = None
    analyzed: bool = False
    # Never analyzed, and every line already has its speaker (podcast
    # scripts, game sheets). Flags never run on these.
    from_import: bool = False
    anchored: int = 0      # "Book says" — the book's own words named the speaker
    guessed: int = 0       # "AI decided"
    by_you: int = 0
    # Lines the render stops on that someone has to look at: a spoken line no
    # speaker was found for. Narration in a book with no narrator is not here
    # — it all waits for one narrator (`narration_waiting`, 2026-10-05).
    no_speaker: int = 0
    flagged: int = 0       # lines inside a flag group
    flag_groups: int = 0
    # Flagged lines + lines with no speaker, once Analyze (or the import)
    # decided the chapter; 0 before.
    to_check: int = 0
    # Narration with no speaker while the book has no narrator: one fix —
    # ＋ Add Narrator — not a line each to check (decided 2026-10-05).
    narration_waiting: int = 0
    changed: int = 0       # lines the last Analyze gave a different speaker
    no_dialogue_found: bool = False
    # Speakers added after this chapter was analyzed whose name (or "also
    # called" name) appears in its text.
    added_since: list[str] = Field(default_factory=list)
    # Lines added or changed by hand since the last Analyze (✎ Edit text makes
    # them with source "manual"; an Analyze decides every line it reads) —
    # Script offers Re-analyze for them.
    edited_since: int = 0


class ProjectScript(BaseModel):
    project_id: str
    chapters: list[ScriptChapter]


class ScriptLine(BaseModel):
    id: str
    position: int
    text: str
    speaker_id: str | None = None
    source: str | None = None
    confidence: float | None = None
    # The paragraph of the analyzed text; null for an imported or pasted line
    # (a paragraph of its own).
    paragraph: int | None = None
    spoken: bool = False
    marker: bool = False
    speakable: bool = True
    # The book's own words that named the speaker ("said Marius").
    anchor_words: str | None = None
    # The model's pick, where the book's words won and it had said another.
    llm_speaker: str | None = None
    # The model's pick the confidence floor dropped.
    floored_from: str | None = None
    # The last Analyze changed this line's speaker; `prev_speaker_id` is who
    # it was (null = it had none).
    changed: bool = False
    prev_speaker_id: str | None = None
    # Indexes into SceneScript.flag_groups.
    flags: list[int] = Field(default_factory=list)
    # The block's whole metadata — Undo puts it back exactly.
    metadata: dict = Field(default_factory=dict)
    # Only a dialogue tag, and the project leaves those out of the audio
    # (Overview → Leave out dialogue tags, extraction/tags.py): shown "Left out".
    left_out: bool = False
    # Rendered takes on the line — Merge says how many it would delete. The
    # chapter page fills it; the grid leaves it 0.
    takes: int = 0
    # Narration with no speaker, in a book with no narrator yet: it waits for
    # the narrator, so it is neither "No speaker" nor "To check" (2026-10-05).
    waits_for_narrator: bool = False


class ScriptFlag(BaseModel):
    check: Literal["run", "only", "disagree", "nearby"]
    speaker: str | None = None
    lines: list[str]
    turns: int = 0
    other: str | None = None


class SceneScript(BaseModel):
    """Script's chapter page: the lines, their marks and the speakers."""

    chapter: ScriptChapter
    project_id: str
    narrator_id: str | None = None
    lines: list[ScriptLine]
    flag_groups: list[ScriptFlag]
    # The book's speakers, most lines first.
    speakers: list[ScriptSpeaker]
