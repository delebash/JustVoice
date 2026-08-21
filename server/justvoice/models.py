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
from pydantic import BaseModel, Field

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
        description="Detected runtime availability: cuda / metal / coreml / directml / rocm / mlx / cpu",
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
    normalize_audio: bool = True
    autoplay_on_generate: bool = True


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


class TrainingValidationSettings(BaseModel):
    min_sample_duration_secs: float = 1.0
    max_sample_duration_secs: float = 60.0
    min_snr_db: float = 15.0
    max_silence_ratio: float = 0.30
    # Share of samples at digital full scale before a clip is called
    # clipped — the pre-flight gate the Train tab applies via /v1/analyze.
    max_clipping_ratio: float = 0.01
    # The Preparer's cut point: a silence at least this long splits a long
    # recording into clips (POST /v1/train/prepare).
    split_silence_secs: float = 0.4
    # Whisper's own certainty about a clip's transcript, 0–1: the geometric
    # mean of the chosen tokens' probabilities (engines/whisper/engine.py
    # `_sequence_confidence`). A clip the transcriber was unsure about is a
    # clip whose text is probably wrong, and a wrong transcript teaches the
    # model the wrong thing. 0.85 is Alexandria's Preparer default
    # (app/static/index.html `prep-confidence`, read 2026-08-21).
    # An engine that cannot measure confidence reports None = UNKNOWN, which
    # never fails the gate.
    min_transcript_confidence: float = 0.85
    min_accepted_samples: int = 3


class TrainingSettings(BaseModel):
    enabled: bool = True
    max_concurrent_jobs: int = 1
    max_samples_per_job: int = 5_000
    sample_loss_every: int = 50
    default_voice_language: str = "en-US"
    validation: TrainingValidationSettings = TrainingValidationSettings()


class KokoroEngineSettings(BaseModel):
    model_dir_override: str | None = None


class EngineModelSourceOverride(BaseModel):
    """Operator-provided source for one engine model variant.

    Per CLAUDE.md "no hardcoded operator-tunable values": engine model
    URLs / HF repos live in each engine's manifest.MODELS as defaults,
    but the operator can override them per (engine, variant) here without
    editing code. The prefetch worker resolves the source as:
      override.url || override.hf_repo+revision || manifest default.
    """

    url: str | None = None           # URL-tarball engines (kokoro, …)
    hf_repo: str | None = None       # HF-snapshot engines (chatterbox, …)
    hf_revision: str | None = None   # pin a commit / tag


class EngineOverrides(BaseModel):
    """Per-engine operator overrides (download sources + the legacy
    kokoro model_dir override). Keyed by variant id in `sources`.

    EnginesSettings.engine_overrides maps engine_id -> EngineOverrides;
    settings.engines.kokoro.model_dir_override stays where it is for
    backward compat (no migration cost — the kokoro adapter already
    reads it from there).
    """

    sources: dict[str, EngineModelSourceOverride] = {}
    # The operator's own default MODEL for this engine (parity batch
    # 2026-08-06 — the Speech-engines page's "Default ✓" row action). A USER
    # layer over the manifest's DEFAULT_VARIANT_ID: the manager's
    # _resolved_default_variant consults this first, so a no-variant load
    # actually loads it (never just relabels a row). None = manifest default.
    default_variant: str | None = None
    # The operator's Device choice for this engine (the 2026-08-13 VRAM
    # wiring, Q2 decided 2026-08-08: "q2 ok"): "auto" | "cuda" | "cpu".
    # None/"auto" = the load door's policy (cpu_adequate manifest fact →
    # cpu; else cuda when the box has it; else cpu). An explicit value
    # passes straight to the engine — including an explicit "cuda" on an
    # engine whose venv may lack GPU wheels: a load error surfacing to an
    # explicit override is acceptable, `auto` never goes there.
    device: str | None = None


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
    kokoro: KokoroEngineSettings = KokoroEngineSettings()
    # Per-engine operator overrides — engine_id -> overrides. Today only
    # holds per-variant download sources; see EngineOverrides.
    engine_overrides: dict[str, EngineOverrides] = {}
    # Preferred TTS engine for create flows + first-render auto-setup
    # (user ask 2026-06-12: a default-engine setting instead of
    # whichever-engine-happens-to-be-first). Engine id, e.g. "kokoro".
    default_tts_engine: str = "kokoro"
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

    stt_model: str = "whisper-turbo"  # variant id on the whisper engine
    language: str = "auto"
    auto_refine: bool = True
    llm_model: str = "qwen3-llm-0.6b"  # variant id on the qwen3-llm engine
    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True
    allow_auto_paste: bool = True
    default_playback_voice: str | None = None
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
    training: TrainingSettings = TrainingSettings()
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
    training: TrainingSettings | None = None
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


# "lora" deliberately breaks the past-participle grammar the other values
# share (cloned/designed/imported/blended). The user-facing word for this
# kind of voice is LoRA — on the tab, on the filter chip, in the docs — and
# the word in the data must be the word on the screen. Renamed from
# "trained" 2026-08-21 with no alias and no back-compat branch: a manifest
# still carrying "trained" is unreadable by design, so a half-rename cannot
# survive unnoticed.
VoiceSource = Literal[
    "preset", "cloned", "designed", "imported", "blended", "lora"
]
StoredVoiceSource = Literal["cloned", "designed", "imported", "blended", "lora"]


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
    source: StoredVoiceSource
    name: str
    language: str
    gender: str | None = None
    design_prompt: str | None = None
    transcript: str | None = None
    sample_count: int = 0
    blend_recipe: BlendRecipe | None = None
    embedding: list[float] | None = None
    adapter_path: str | None = None
    training_job_id: str | None = None
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
    name: str
    ref_wav_b64: str
    language: str = "en-US"
    gender: str | None = None
    transcript: str | None = None


class DesignVoiceRequest(BaseModel):
    engine: str
    name: str
    prompt: str
    language: str = "en-US"
    gender: str | None = None


class ImportVoiceRequest(BaseModel):
    engine: str
    name: str
    wav_b64: str
    language: str = "en-US"
    gender: str | None = None
    transcript: str | None = None


# ─── Personas ───────────────────────────────────────────────────────────


class Persona(BaseModel):
    id: str
    name: str
    # Optional — a persona can exist before a voice is cast (Studio Cast
    # binds voices later; render skips voice-less personas). Was required,
    # which 422'd persona creation with an empty voice library
    # (user-hit 2026-06-12).
    voice_id: str | None = None
    # Persona is the sole identity layer after the Profile-kill (plan Q1).
    # All voice-styling fields live here directly, not behind a Profile FK.
    language: str = "en"
    avatar_path: str | None = None
    # Spoken-delivery instruction — the ONE field that changes the audio.
    # Engines whose manifest declares `instruct_field` consume it as the
    # `instruct` / style-prompt field at render time; engines that don't
    # accept it ignore it. **Never an LLM rewrite of the manuscript** —
    # Rewrite is a separate explicit tool.
    voice_instruct: str | None = None
    # The character sheet — who this character is, in prose. Read by
    # Compose / Rewrite, smart-assign casting and the game-export sidecar.
    # It never reaches an engine — that is `voice_instruct`'s job alone
    # (the 2026-08-15 split; one field serving both was the bug).
    personality: str | None = None
    # Tier-2 delivery overlay defaults (3-tier voice tuning per task #88):
    #   render_preset (Tier 3) > persona.default_delivery (Tier 2) > engine (Tier 1).
    # JSON dict matching the Delivery shape (speed / pitch / gain_db / etc).
    default_delivery: dict[str, Any] = {}
    # Effects chain — applied after TTS produces WAV (see audio/dsp/). List
    # of {type, params} dicts. Cascade order: persona → render preset (overlay)
    # → per-block override. Wired in Slice 6.
    effects_chain: list[dict[str, Any]] = []
    lexicon_id: str | None = None
    engine_override: str | None = None
    # Legacy rewrite-toggle fields. Kept on disk for backwards-compatibility
    # with existing persona JSON files. The actual Rewrite affordance becomes
    # an explicit button on Generate / Studio Script tab (Slice 3) — these
    # flags will be dropped in Slice 4 after the UI is migrated.
    llm_rewrite_enabled: bool = False
    llm_model: str | None = None
    imported_from: str | None = None
    imported_id: str | None = None
    # True for personas the project lifecycle auto-creates (Narrator on
    # audiobook + podcast projects). The personas DELETE endpoint refuses
    # to remove builtins; rename + voice reassignment still work.
    is_builtin: bool = False
    created_at: datetime
    updated_at: datetime


class PersonaList(BaseModel):
    personas: list[Persona]


class CreatePersonaRequest(BaseModel):
    name: str
    voice_id: str | None = None
    language: str = "en"
    avatar_path: str | None = None
    voice_instruct: str | None = None
    personality: str | None = None
    default_delivery: dict[str, Any] = {}
    effects_chain: list[dict[str, Any]] = []
    lexicon_id: str | None = None
    engine_override: str | None = None
    # Legacy — see Persona model
    llm_rewrite_enabled: bool = False
    llm_model: str | None = None


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
    "training",
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
    # Importable module names this engine needs to load. Catalog-static —
    # used by the installer to decide whether a pip step is needed and to
    # check (via find_spec) whether the install eventually made the engine
    # importable.
    runtime_deps: list[str] = []
    # pip package specs (e.g. "sherpa-onnx>=1.13"). The installer pip-installs
    # these as the first phase of an Install before downloading model files.
    # Empty means "no pip step needed" — either pure-Python or pip name not
    # yet known.
    pip_packages: list[str] = []
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
    # Always "venv" since 2026-08-22: every engine gets its own environment,
    # built to exactly what its manifest declares. The other value was
    # "shared" — one interpreter holding most engines at once, where each
    # install re-resolved every other engine's dependencies. The field stays
    # so the client can see what it is rather than assume.
    isolation: str = "venv"
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
    # Model-weights license — distinct from framework code license (the
    # `license` field above tracks the Python package). Common values:
    # "Apache-2.0", "MIT", "Llama-3.2-Community", "CC-BY-NC-4.0".
    # Set per engine manifest (`WEIGHTS_LICENSE = "..."`). Surfaced in
    # the Engines tab so users selling produced audio know the terms.
    weights_license: str = ""
    # Attribution text the producing tool must display when the user
    # ships output produced by this engine. Llama-3.2 §1.b mandates
    # "Built with Llama" for any Llama-derivative model — TADA hits
    # this. Empty string means no attribution required.
    #
    # Rendered as a pill next to the engine's description in the Engines
    # tab (`EnginesView.vue`, `.ev-attrib`), with the weights licence in
    # its tooltip. This is a LICENCE OBLIGATION, not decoration — the
    # field reached the API in June but nothing consumed it until
    # 2026-07-29, so the notice the licence requires was not actually
    # being shown. Do not drop the render without checking the licence.
    attribution: str = ""
    # The device the last confirmed load actually resolved to (the 2026-08-13
    # VRAM wiring, Q2: resolved device always visible, never hidden). null =
    # not loaded this server process.
    resolved_device: str | None = None


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
# Generate view + the paralinguistic slash menu.


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


class TrainingSpec(BaseModel):
    """Per-engine LoRA training defaults — the values the Train form opens
    with. Each set is lifted from a code-verified upstream recipe (cited on
    the capability row), never invented here."""

    epochs: int
    learning_rate: float
    batch_size: int
    grad_accum: int
    lora_rank: int
    lora_alpha: int
    # None = the trainer script's own default dtype.
    precision: str | None = None
    target_modules: list[str] = []


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
    supports_training: bool = False  # a LoRA fine-tune path exists for this variant
    # Present exactly when supports_training is True.
    training_defaults: TrainingSpec | None = None

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


class ModelsListResponse(BaseModel):
    engine_id: str
    variants: list[ModelVariant]


class InstallRequest(BaseModel):
    model_variant: str | None = None


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
    pip_packages_removed: list[str] = []


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
    # Tier-2 voice tuning — persona.default_delivery resolves via PersonaStore
    # at render time.
    persona_id: str | None = None
    # Tier-3 render preset (task #88) — if set, preset overrides request +
    # persona delivery. Highest precedence in the 3-tier merge.
    preset_id: str | None = None


class ChapterLine(BaseModel):
    voice: str
    text: str
    language: str | None = None
    delivery: Delivery | None = None
    seed: int | None = None
    # Resolved effects chain for this line (persona → render preset). Scene
    # mode fills it from the block's persona; direct-mode callers may pass
    # one. Part of the render cache key — see render_core.render_line.
    effects: list[dict] | None = None


class BetweenLines(BaseModel):
    silence_ms: int = 250


class RenderChapterRequest(BaseModel):
    # Direct mode: pass `lines[]` literally (the legacy path — JustWrite
    # adapter, single-chapter renders from CLI, etc.).
    # Scene mode: pass `scene_id` (+ optional `preset_id`); the server
    # resolves blocks → personas → lines internally. `lines` may be omitted
    # in scene mode.
    lines: list[ChapterLine] = []
    scene_id: str | None = None
    preset_id: str | None = None
    between_lines: BetweenLines = BetweenLines()
    master: Literal["acx", "inaudio", "podcast", "youtube", "none"] | None = None
    title: str | None = None
    author: str | None = None
    book: str | None = None
    cache_scope: str = "default"
    lexicons: list[str] = []


# ─── Phase 5 — blend + train ───────────────────────────────────────────


class BlendVoiceRequest(BaseModel):
    engine: str
    name: str
    # Weighted strategies (blend / extrapolate / vector). One id may be
    # blending.MEAN_SOURCE, which resolves to the pack's average voice.
    source_voice_ids: list[str] = Field(default_factory=list)
    weights: list[float] | None = None
    strategy: BlendStrategy = "blend"
    # recombine only.
    segments: list[BlendSegment] | None = None


class TrainingSample(BaseModel):
    wav_b64: str
    transcript: str


# "uploaded" = came in as a ZIP (Alexandria interchange or our own export).
TrainingDatasetOrigin = Literal["clips", "prepared", "generated", "uploaded"]


class TrainingDataset(BaseModel):
    id: str
    name: str
    clip_count: int
    total_seconds: float
    created_at: datetime
    # The language the clips are SPOKEN in. A LoRA adapter carries the
    # phonology of its training language, so a run must train with the
    # matching codec language token — the dataset is where that fact
    # belongs, not the run form.
    language: str | None = None
    # Which clip is the voice's identity anchor. It becomes ref.wav +
    # ref_text.txt, the speaker embedding is extracted from it before
    # training, and it is replayed as the voice prompt on EVERY later
    # render (qwen3/engine.py `_lora_clone_prompt`). None = the runner
    # picks the longest clip, which is the old always-on behaviour.
    ref_index: int | None = None
    ref_transcript: str | None = None
    # How the set was made — clips added by hand, cut from one recording
    # by the Preparer, or generated line-by-line in the Dataset builder.
    origin: TrainingDatasetOrigin = "clips"


class TrainingDatasetList(BaseModel):
    datasets: list[TrainingDataset]


class CreateTrainingDatasetRequest(BaseModel):
    name: str
    samples: list[TrainingSample]
    language: str | None = None
    ref_index: int | None = None
    origin: TrainingDatasetOrigin = "clips"


class UpdateTrainingDatasetRequest(BaseModel):
    """Rename, retarget the reference clip, or correct the language of a
    dataset that already exists. Every field optional — absent = unchanged."""

    name: str | None = None
    language: str | None = None
    ref_index: int | None = None


class TrainVoiceRequest(BaseModel):
    engine: str
    name: str
    # Either inline clips OR a saved dataset (training_datasets storage) —
    # dataset_id wins when both are present.
    samples: list[TrainingSample] = []
    dataset_id: str | None = None
    # Which checkpoint family to fine-tune (e.g. "qwen3-base-1.7b",
    # "chatterbox-turbo"). None = the engine's default trainable variant.
    variant: str | None = None
    # None on any knob = the engine's training_defaults (capability surface).
    epochs: int | None = None
    learning_rate: float | None = None
    batch_size: int | None = None
    grad_accum: int | None = None
    lora_rank: int | None = None
    lora_alpha: int | None = None
    language: str | None = None
    # base_voice DIED 2026-08-21 (review R4): it never reached any trainer
    # — only the legacy worker's metadata json ever read it, so the field
    # was a control that moved nothing.
    # Override the dataset's stored reference clip for THIS run only. None =
    # the dataset's own ref_index, and failing that the longest clip.
    ref_index: int | None = None


TrainingPhase = Literal[
    "queued", "validating", "preparing", "running", "completed", "failed", "cancelled"
]


class SampleReport(BaseModel):
    index: int
    accepted: bool
    duration_seconds: float
    rejection_reason: str | None = None
    snr_db: float | None = None


class DatasetValidation(BaseModel):
    accepted: int
    rejected: int
    reports: list[SampleReport] = []
    usable_seconds: float
    avg_wer: float | None = None
    speaker_consistency: float | None = None


class TrainJob(BaseModel):
    job_id: str
    engine: str
    voice_name: str
    phase: TrainingPhase
    progress: float
    loss_curve: list[float] = []
    eta_seconds: int | None = None
    validation: DatasetValidation | None = None
    final_voice_id: str | None = None
    error: str | None = None
    # Stamped at enqueue so the Trained-adapters table can say what a run
    # was, without re-deriving it from the request that made it.
    epochs: int | None = None
    sample_count: int | None = None
    # Which dataset fed the run, so the adapters table can name it instead
    # of leaving the reader to guess which clips made this voice.
    dataset_id: str | None = None
    dataset_name: str | None = None
    # The language the run trained at — the codec language token the
    # adapter now carries. Stamped so a finished adapter can say what it
    # speaks rather than being assumed English.
    language: str | None = None
    # The trainer's own output, newest last. A progress bar says a run is
    # moving; only the log says WHAT it is doing and why it stopped.
    # Capped server-side (storage/training_jobs.JOB_LOG_CAP) — a long run
    # must not grow the job record without bound.
    logs: list[str] = []


class TrainJobList(BaseModel):
    jobs: list[TrainJob]


class TrainingCallback(BaseModel):
    job_id: str
    phase: TrainingPhase
    progress: float
    loss_curve_append: list[float] = []
    eta_seconds: int | None = None
    validation: DatasetValidation | None = None
    adapter_path: str | None = None
    error: str | None = None
    # Trainer stdout lines to append to the job's log ring.
    logs_append: list[str] = []


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
    # Estimated SNR (frame-percentile method, analyzer.py) — None when the
    # clip is too short to frame. Feeds the training clip gates.
    snr_db: float | None = None
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
