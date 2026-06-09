"""Pydantic models for the entire API surface.

One file because they cross-reference each other heavily and the
total stays under ~600 lines. The Rust crate split these across many
modules; in Python the import overhead from many small files is worse
than the readability cost of one bigger file.

Models are grouped by domain with section comment dividers.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

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


class CorsSettings(BaseModel):
    origins: list[str] = []


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
    acx: MasterPreset = MasterPreset(
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
    base_url: str
    api_key: str | None = None
    model: str
    voices: list[str] = []
    response_format: str = "wav"


class EnginesSettings(BaseModel):
    kokoro: KokoroEngineSettings = KokoroEngineSettings()
    external: list[ExternalEngineConfig] = []


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
    default_delivery: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime


class PersonaList(BaseModel):
    personas: list[Persona]


class CreatePersonaRequest(BaseModel):
    name: str
    voice_id: str
    default_delivery: dict[str, Any] = {}


# ─── Lexicons ───────────────────────────────────────────────────────────


class LexiconEntry(BaseModel):
    grapheme: str
    phoneme_ipa: str | None = None
    alias: str | None = None


class Lexicon(BaseModel):
    id: str
    name: str
    entries: list[LexiconEntry] = []
    created_at: datetime
    updated_at: datetime


class LexiconList(BaseModel):
    lexicons: list[Lexicon]


class CreateLexiconRequest(BaseModel):
    name: str
    entries: list[LexiconEntry] = []


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


class EnginesListResponse(BaseModel):
    engines: list[EngineInfo]
    current: str | None = None


class CurrentEngineResponse(BaseModel):
    engine: EngineInfo | None = None


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


# ─── Jobs (install progress) ────────────────────────────────────────────


JobPhase = Literal[
    "connecting", "downloading", "verifying", "extracting", "completed", "failed"
]


class JobStatus(BaseModel):
    job_id: str
    engine_id: str
    model_variant: str
    phase: JobPhase
    bytes_downloaded: int = 0
    bytes_total: int = 0
    current_file: str | None = None
    error: str | None = None


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


class ChapterLine(BaseModel):
    voice: str
    text: str
    language: str | None = None
    delivery: Delivery | None = None
    seed: int | None = None


class BetweenLines(BaseModel):
    silence_ms: int = 250


class RenderChapterRequest(BaseModel):
    lines: list[ChapterLine]
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
