"""Per-engine model variants — installable model files with URLs,
sizes, VRAM, quality scores.

Mirrors the Rust ``engines::model_catalog``. URLs use HuggingFace
``/resolve/main/`` for sidecar engines (HF cache handles the actual
download via ``from_pretrained`` on first load) and direct GitHub
release tarballs for Kokoro.
"""

from __future__ import annotations

from ..models import ModelFile, ModelVariant


def models_for(engine_id: str) -> list[ModelVariant]:
    match engine_id:
        case "kokoro":
            return _kokoro_variants()
        case "qwen3":
            return _qwen3_variants()
        case "chatterbox":
            return _chatterbox_variants()
        case "luxtts":
            return _luxtts_variants()
        case "tada":
            return _tada_variants()
        case "dia":
            return _dia_variants()
        case "moss-tts":
            return _moss_tts_variants()
        case _:
            return []


def _hf_placeholder(repo: str, size_mb: int) -> ModelFile:
    """Marker for sidecar engines — actual download is via HF cache on load."""
    return ModelFile(
        url=f"https://huggingface.co/{repo}/resolve/main/model.safetensors",
        sha256="TODO_FILL_SHA256_FROM_HF",
        target_path="model.safetensors",
        size_bytes=size_mb * 1024 * 1024,
    )


def _kokoro_variants() -> list[ModelVariant]:
    return [
        ModelVariant(
            id="kokoro-multi-lang-v1_0",
            name="Kokoro v1.0 multilingual",
            description=(
                "All 54 voices across 8 languages (English, Japanese, Mandarin, "
                "Spanish, French, Hindi, Italian, Portuguese). Canonical Kokoro "
                "model from k2-fsa's sherpa-onnx releases."
            ),
            size_mb=700,
            vram_mb=1500,
            quality=95,
            languages=[
                "en-US", "en-GB", "ja", "zh", "es", "fr", "hi", "it", "pt-BR",
            ],
            files=[
                ModelFile(
                    url="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
                    sha256="TODO_FILL_SHA256_FROM_RELEASE",
                    target_path=".bundle.tar.bz2",
                    size_bytes=700 * 1024 * 1024,
                )
            ],
        ),
        ModelVariant(
            id="kokoro-en-v0_19",
            name="Kokoro v0.19 English-only",
            description=(
                "English voices only (American + British). Smaller download (~330 MB) "
                "for users who don't need multilingual."
            ),
            size_mb=330,
            vram_mb=1200,
            quality=92,
            languages=["en-US", "en-GB"],
            files=[
                ModelFile(
                    url="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
                    sha256="TODO_FILL_SHA256_FROM_RELEASE",
                    target_path=".bundle.tar.bz2",
                    size_bytes=330 * 1024 * 1024,
                )
            ],
        ),
    ]


_QWEN_LANGS = [
    "en", "zh", "ja", "es", "fr", "de", "ko", "it", "pt-BR", "ru", "ar",
    "tr", "nl", "pl", "vi", "th", "id",
]


def _qwen3_variants() -> list[ModelVariant]:
    return [
        ModelVariant(
            id="qwen3-tts-1.7b",
            name="Qwen3-TTS 1.7B",
            description="Highest English WER of the open-weight engines. Full feature set.",
            size_mb=3500,
            vram_mb=7000,
            quality=92,
            languages=_QWEN_LANGS,
            files=[_hf_placeholder("Qwen/Qwen3-TTS-1.7B", 3500)],
        ),
        ModelVariant(
            id="qwen3-tts-0.6b",
            name="Qwen3-TTS 0.6B",
            description="Same feature set, lower quality ceiling, ~half VRAM, ~3× faster.",
            size_mb=1200,
            vram_mb=3500,
            quality=80,
            languages=_QWEN_LANGS,
            files=[_hf_placeholder("Qwen/Qwen3-TTS-0.6B", 1200)],
        ),
    ]


def _chatterbox_variants() -> list[ModelVariant]:
    return [
        ModelVariant(
            id="chatterbox-original-v1",
            name="Chatterbox Original (500M, English)",
            description="Original 500M-param English model. Emotion exaggeration + CFG controls. Highest English quality of the three.",
            size_mb=2800,
            vram_mb=7000,
            quality=90,
            languages=["en"],
            files=[_hf_placeholder("ResembleAI/chatterbox", 2800)],
        ),
        ModelVariant(
            id="chatterbox-turbo-v1",
            name="Chatterbox Turbo (350M, English)",
            description="Streamlined 350M-param variant. Native paralinguistic tags ([cough], [laugh], [chuckle]). Lower latency.",
            size_mb=2200,
            vram_mb=6000,
            quality=82,
            languages=["en"],
            files=[_hf_placeholder("ResembleAI/chatterbox-turbo", 2200)],
        ),
        ModelVariant(
            id="chatterbox-multilingual-v2",
            name="Chatterbox Multilingual v2 (500M, 23 langs)",
            description="500M-param multilingual covering 23 languages via the request's `language` field.",
            size_mb=2800,
            vram_mb=7000,
            quality=88,
            languages=[
                "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi",
                "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv",
                "sw", "tr", "zh",
            ],
            files=[_hf_placeholder("ResembleAI/chatterbox-multilingual", 2800)],
        ),
    ]


def _luxtts_variants() -> list[ModelVariant]:
    return [
        ModelVariant(
            id="luxtts-base",
            name="LuxTTS",
            description="Multilingual TTS, lighter footprint, broad language coverage.",
            size_mb=1200,
            vram_mb=3000,
            quality=80,
            languages=["en", "es", "fr", "de", "it", "ja", "zh"],
            files=[_hf_placeholder("luxtts/luxtts-base", 1200)],
        )
    ]


def _tada_variants() -> list[ModelVariant]:
    return [
        ModelVariant(
            id="tada-1b",
            name="TADA 1B",
            description="Hume's TADA 1B — voice cloning + multilingual presets.",
            size_mb=4000,
            vram_mb=8000,
            quality=85,
            languages=["en", "es", "fr", "de", "it"],
            files=[_hf_placeholder("hume/tada-1b", 4000)],
        ),
        ModelVariant(
            id="tada-3b",
            name="TADA 3B",
            description="Hume's TADA 3B — highest TADA quality.",
            size_mb=12000,
            vram_mb=16000,
            quality=92,
            languages=["en", "es", "fr", "de", "it"],
            files=[_hf_placeholder("hume/tada-3b", 12000)],
        ),
    ]


def _dia_variants() -> list[ModelVariant]:
    return [
        ModelVariant(
            id="dia-1.6b",
            name="Dia 1.6B",
            description="Multi-speaker single-pass dialogue.",
            size_mb=3500,
            vram_mb=8000,
            quality=85,
            languages=["en"],
            files=[_hf_placeholder("nari-labs/dia-1.6b", 3500)],
        ),
        ModelVariant(
            id="dia-2-2b",
            name="Dia 2-2B",
            description="Higher-quality multi-speaker dialogue.",
            size_mb=5500,
            vram_mb=12000,
            quality=92,
            languages=["en"],
            files=[_hf_placeholder("nari-labs/dia-2-2b", 5500)],
        ),
    ]


def _moss_tts_variants() -> list[ModelVariant]:
    return [
        ModelVariant(
            id="moss-tts-v1.5",
            name="MOSS-TTS v1.5",
            description="MOSS-TTS — 1-hour stable single-pass generation.",
            size_mb=12000,
            vram_mb=16000,
            quality=90,
            languages=["en", "zh"],
            files=[_hf_placeholder("moss-llm/moss-tts-v1.5", 12000)],
        )
    ]


def recommend_for_vram(
    engine_id: str, available_vram_mb: int | None
) -> tuple[ModelVariant | None, ModelVariant | None, list[str]]:
    """Return (best_fit, fastest, would_oom_ids)."""
    variants = models_for(engine_id)
    if not variants:
        return None, None, []
    if available_vram_mb is None:
        # CPU mode — pick the smallest variant
        smallest = min(variants, key=lambda v: v.size_mb)
        return smallest, smallest, []

    fits = [v for v in variants if (v.vram_mb or 0) <= available_vram_mb]
    would_oom = [v.id for v in variants if (v.vram_mb or 0) > available_vram_mb]
    if not fits:
        return None, None, would_oom
    best_fit = max(fits, key=lambda v: v.quality)
    fastest = min(fits, key=lambda v: v.vram_mb or 0)
    return best_fit, fastest, would_oom
