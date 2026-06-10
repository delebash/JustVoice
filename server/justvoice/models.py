"""Pydantic models for the entire API surface.

One file because they cross-reference each other heavily and the
total stays under ~600 lines. The Rust crate split these across many
modules; in Python the import overhead from many small files is worse
than the readability cost of one bigger file.

Models are grouped by domain with section comment dividers.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# ─── Common / system ────────────────────────────────────────────────────


class EngineHealth(BaseModel):
    id: str
    name: str
    ready: bool
    backend: str


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded", "down"] = "ok"
    version: str
    api_version: str
    current_engine: str | None = None
    # Variant loaded in the TTS slot — drives the topbar "engine · variant"
    # swap-status pill.
    current_variant: str | None = None
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
    normalize_audio: bool = True
    autoplay_on_generate: bool = True
    # Swap-at-render (WS2): when true, renders that need a different
    # managed engine swap silently instead of returning the 409
    # engine-swap-required contract. Set by the swap prompt's
    # "always swap without asking" checkbox.
    auto_engine_swap: bool = False


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


class ExternalEngineConfig(BaseModel):
    id: str
    name: str
    base_url: str = ""
    api_key: str | None = None
    model: str = ""
    voices: list[str] = []
    response_format: str = "wav"
    # Phase 2 / Slice 5 — TTS provider type discriminator. Default
    # "openai-compat" matches the prior single-pattern behavior so
    # existing settings.engines.external entries keep working without
    # edits. New types: elevenlabs / speechify / speechmatics / openai-tts /
    # edge-tts (Edge TTS deferred — needs Tauri-side msedge-tts wiring).
    provider_type: str = "openai-compat"


class LLMProviderConfig(BaseModel):
    """Phase 2 / Slice 3 — registered LLM provider entry.

    Mirrors JustWrite's per-provider settings shape. `provider_type`
    discriminates which adapter (anthropic / openai / openai-compat /
    gemini / ollama / deepseek / openrouter) handles the dispatch.
    `base_url` defaults are baked into the adapter; setting it here
    overrides (used for self-hosted Ollama or proxy endpoints).
    """

    id: str
    name: str
    provider_type: str  # "anthropic" | "openai" | "openai-compat" | "gemini" | "ollama" | "deepseek" | "openrouter"
    base_url: str = ""
    api_key: str | None = None
    default_model: str = ""
    timeout_seconds: int = 60
    extra: dict[str, str] = {}  # provider-specific extras (org id, region, etc.)


class FeaturePinConfig(BaseModel):
    """Phase 2 / Slice 7 — which provider+model handles each LLM feature.

    Looked up at dispatch time by feature key (compose / persona_rewrite /
    speaker_attribution / render_preset_suggest / smart_assign). The QuickSetup
    wizard pre-fills these based on the hardware tier preset.
    """

    feature: str  # "compose" | "persona_rewrite" | "speaker_attribution" | "render_preset_suggest" | "smart_assign"
    provider_id: str
    model: str = ""
    tier: str | None = None  # "guided" | "direct" | "reasoned" — null = use auto-classify


class EnginesSettings(BaseModel):
    # Torch wheel-index override for the shared venv. "" = auto-detect
    # (nvidia-smi → CUDA, Apple Silicon → MPS, else CPU). Set to a wheel
    # index URL (e.g. https://download.pytorch.org/whl/cpu or .../rocm6.0)
    # to force a backend; takes effect on the next engine setup run.
    # The JUSTVOICE_TORCH_INDEX env var still wins over this setting.
    torch_index_override: str = ""
    kokoro: KokoroEngineSettings = KokoroEngineSettings()
    external: list[ExternalEngineConfig] = []
    # Phase 2 / Slice 3 — LLM provider registry. Each entry registers an
    # adapter at boot (server/justvoice/engines/llm/registry.py).
    llm: list[LLMProviderConfig] = []
    # Phase 2 / Slice 7 — pin LLM features to specific provider+model+tier.
    feature_pins: list[FeaturePinConfig] = []


class CaptureSettings(BaseModel):
    """Dictation / capture pipeline knobs (Settings → Capture)."""

    # Whisper size loaded on first capture (base/small/medium/large/turbo).
    stt_model: str = "base"
    # "auto" lets Whisper detect; anything else forces a language code.
    language: str = "auto"
    # Run LLM refinement automatically after STT completes.
    auto_refine: bool = False
    # Refinement behaviour toggles (see refinement.py prompt builder).
    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True


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
    captures: CaptureSettings = CaptureSettings()
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
    captures: CaptureSettings | None = None
    app: AppSettings | None = None


class SettingsPatchResponse(BaseModel):
    settings: Settings
    restart_required: list[str] = []


# ─── Voices ─────────────────────────────────────────────────────────────


VoiceSource = Literal[
    "preset", "cloned", "designed", "imported", "blended", "trained"
]
StoredVoiceSource = Literal["cloned", "designed", "imported", "blended", "trained"]


class BlendRecipe(BaseModel):
    sources: list[str]
    weights: list[float]
    strategy: Literal["lerp", "slerp", "weighted_sum"] = "slerp"


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
    # Availability truth (WS1): is this voice's engine occupying its kind
    # slot right now, and which variant produced/serves the voice. Pickers
    # show every voice regardless — these flags only drive the
    # loaded/swap-needed badges, never filtering.
    engine_loaded: bool = False
    variant_id: str | None = None


class VoiceList(BaseModel):
    voices: list[Voice]


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
    voice_id: str
    # Persona is the sole identity layer after the Profile-kill (plan Q1).
    # All voice-styling fields live here directly, not behind a Profile FK.
    language: str = "en"
    avatar_path: str | None = None
    # Character context (backstory, age, mannerisms) — distinct from `personality`.
    bio: str | None = None
    # TTS delivery instruction. Engines that declare `supports_instruct_freeform`
    # (Qwen3-TTS, LuxTTS) consume it as the `instruct` / style-prompt field at
    # render time. Engines that don't accept it ignore it. Smart-assign uses it
    # as input context for voice matching. **Never an LLM rewrite of the
    # manuscript at render time** — Rewrite is a separate explicit tool.
    personality: str | None = None
    # Tier-2 delivery overlay defaults (3-tier voice tuning per task #88):
    #   render_preset (Tier 3) > persona.default_delivery (Tier 2) > engine (Tier 1).
    # JSON dict matching the Delivery shape (speed / pitch / gain_db / etc).
    default_delivery: dict[str, Any] = {}
    # Effects chain — pedalboard-backed, applied after TTS produces WAV. List
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
    created_at: datetime
    updated_at: datetime


class PersonaList(BaseModel):
    personas: list[Persona]


class CreatePersonaRequest(BaseModel):
    name: str
    voice_id: str
    language: str = "en"
    avatar_path: str | None = None
    bio: str | None = None
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
    "streaming_generation",
    "embedding_blending",
    "training",
]


class Prerequisites(BaseModel):
    rust_feature: str | None = None
    rust_native: bool = False
    sidecar: bool = False
    disk_space_mb: int = 0
    model_files_needed: list[str] = []
    gpu_runtimes: list[str] = []


class EngineInfo(BaseModel):
    id: str
    name: str
    description: str
    backend: str
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
    # Phase 2 / Slice 1 — the actual variant currently loaded for this
    # engine (server-truth, not local-state). null when the engine isn't
    # loaded. The dropdown UI uses this to label "Loaded: <variant>"
    # correctly across page refreshes.
    current_variant_id: str | None = None
    # "shared" (engine runs against the shared venv at engines/.shared-venv,
    # monolithic shared-venv style — fast Install = model-only download) or "venv"
    # (engine gets its own private venv, for engines that genuinely conflict
    # with the shared interpreter). Default is "shared".
    isolation: str = "shared"
    # OSes this engine works on. UI hides engines whose list doesn't include
    # the user's current OS. Values: "windows" | "linux" | "macos".
    supported_oses: list[str] = []
    # Model-weights license — distinct from framework code license (the
    # `license` field above tracks the Python package). Common values:
    # "Apache-2.0", "MIT", "Llama-3.2-Community", "CC-BY-NC-4.0".
    # Set per engine manifest (`WEIGHTS_LICENSE = "..."`). Surfaced in
    # the Engines tab so users selling produced audio know the terms.
    weights_license: str = ""
    # Attribution text the producing tool must display when the user
    # ships output produced by this engine. Llama-3.2 §1.b mandates
    # "Built with Llama" for any Llama-derivative model — TADA hits
    # this. Empty string means no attribution required. The UI shows
    # a copyable attribution row when this is non-empty.
    attribution: str = ""


class EnginesListResponse(BaseModel):
    engines: list[EngineInfo]
    current: str | None = None


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
    use different syntaxes — Chatterbox-Turbo uses `[laugh]`, Dia uses
    `(sighs)`, MOSS uses `[S1] [S2] [pause 1.5s]`.
    """

    category: str  # "emotion" | "style" | "prosody" | "sfx" | "paralinguistic" | "speaker" | "pause"
    label: str
    tags: list[str]
    syntax: str  # f-string with {value}, e.g. "<|emotion:{value}|>"
    placement: Literal["start_of_turn", "inline_anywhere"] = "inline_anywhere"
    hint: str = ""


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
    supports_multi_speaker: bool = False  # MOSS speaker_prompts map
    supports_style_prompt: bool = False  # qwen3 style-prompt field (e.g. "warm narrative voice, calm tempo")

    # Numeric / continuous knobs (sliders)
    knobs: list[KnobSpec] = []

    # Inline-tag taxonomies (slash menu + capability hints)
    inline_tags: list[InlineTagSet] = []

    # Pitch — special-cased because it's the most-requested control even
    # though most engines lack it natively. Values:
    # - native_st_range: engine's own pitch range (only LuxTTS currently)
    # - post_process_available: server can do pedalboard WAV pitch-shift
    #   on the output regardless of engine support
    pitch_native_st_range: list[int] | None = None  # [min, max] semitones
    pitch_post_process: bool = False

    # Free-form notes for the UI to display under the capability banner.
    notes: list[str] = []


class EngineCapabilitiesResponse(BaseModel):
    """`GET /v1/engines/capabilities` payload."""

    engines: dict[str, EngineCapabilityDetail]


class ModelFile(BaseModel):
    url: str
    sha256: str
    target_path: str
    size_bytes: int


class ModelVariant(BaseModel):
    id: str
    name: str
    description: str
    size_mb: int
    vram_mb: int | None = None
    quality: int
    languages: list[str]
    files: list[ModelFile] = []


class ModelsListResponse(BaseModel):
    engine_id: str
    variants: list[ModelVariant]


class RecommendedResponse(BaseModel):
    engine_id: str
    best_fit: ModelVariant | None = None
    fastest: ModelVariant | None = None
    would_oom: list[str] = []
    detected_vram_mb: int | None = None


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


class Delivery(BaseModel):
    speed: float | None = None
    emotion: Emotion | None = None
    pitch: float | None = None
    pause_before: int | None = None
    pause_after: int | None = None
    gain_db: float | None = None
    instruct: str | None = None
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
    # Explicit effect-chain preset picked on the Generate view (Effects
    # chip). Layers between the persona chain and the render preset's
    # chain; the EffectPreset's chain is copied at render time.
    effects_preset_id: str | None = None
    # Swap-at-render contract (WS2): opt-in to loading a different managed
    # engine when the voice needs one. False → 409 engine-swap-required.
    allow_engine_swap: bool = False


class ChapterLine(BaseModel):
    voice: str
    text: str
    language: str | None = None
    delivery: Delivery | None = None
    seed: int | None = None


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
    # Swap-at-render contract (WS2). Batch renders group lines by engine
    # server-side, so a multi-engine cast costs one swap per engine.
    allow_engine_swap: bool = False


# ─── Phase 5 — blend + train ───────────────────────────────────────────


class BlendVoiceRequest(BaseModel):
    engine: str
    name: str
    source_voice_ids: list[str]
    weights: list[float] | None = None
    strategy: Literal["lerp", "slerp", "weighted_sum"] = "slerp"


class TrainingSample(BaseModel):
    wav_b64: str
    transcript: str


class TrainVoiceRequest(BaseModel):
    engine: str
    name: str
    samples: list[TrainingSample]
    epochs: int | None = None
    learning_rate: float | None = None
    base_voice: str | None = None


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
