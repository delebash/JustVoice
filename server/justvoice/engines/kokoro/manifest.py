"""Manifest for the Kokoro engine plugin.

Kokoro (via sherpa-onnx-python) is the lightest engine in the catalog —
no torch, no transformers, just the ONNX runtime. 54 preset voices across
8 languages; the multilingual tarball download is 333 MB (HEAD-verified).
"""

ID = "kokoro"
NAME = "Kokoro"

# Voicebox-style monolith: this engine's Python deps go into the shared
# venv that ALL `ISOLATION="shared"` engines run against. After the one-time
# Setup, clicking Load on Kokoro just downloads the model tarball (if not
# already there) and loads it. No per-engine pip install at Load time.
ISOLATION = "shared"
SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "k2-fsa's Kokoro via sherpa-onnx — 54 preset voices across 8 languages "
    "(en-US, en-GB, ja, zh, es, fr, hi, it, pt-BR). ~50 MB Python install, "
    "333 MB model download. CUDA / CoreML / DirectML / CPU."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": True,
    "voice_cloning": False,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
    "phoneme_override": True,
}

REQUIREMENTS = {
    "gpu_runtimes": ["cuda", "coreml", "directml", "cpu"],
    # The 2026-08-13 VRAM wiring (Q2's auto policy): Kokoro is real-time on
    # CPU (ONNX, no torch) — `auto` resolves to cpu and the load books no
    # device memory on discrete boxes. The only engine flagged at the wiring;
    # luxtts stays unflagged until its real-time-on-CPU claim is verified.
    "cpu_adequate": True,
}

# uv pip install steps run against engines/kokoro/.venv.  No torch needed
# — sherpa-onnx ships its own ONNX runtime as a wheel.  numpy comes in via
# justvoice-plugin (the host installs that one automatically).
INSTALL = [
    # Python dep.
    {"kind": "pip", "packages": ["sherpa-onnx>=1.13"]},
    # Model files — k2-fsa publishes the canonical Kokoro tarball on
    # sherpa-onnx GitHub Releases. ~700 MB. skip_verify=True until the
    # SHA-256 is filled in (k2-fsa doesn't publish one alongside the
    # release; we'd compute it once and pin it here).
    {
        "kind": "model-tarball",
        "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
        "sha256": "TODO_FILL_SHA256_FROM_RELEASE",
        "expected_files": ["model.onnx", "voices.bin", "tokens.txt"],
    },
]

# Voices exposed to the host catalog even when the engine isn't loaded —
# Kokoro's voice list is static (54 presets, no clones). Voice-cloning
# engines (Chatterbox/Qwen3/etc.) leave this empty; their voices live
# in the host's voice store once cloned and don't need static declaration.
from .voices import preset_voices_as_dicts as _preset_voices_as_dicts  # noqa: E402

STATIC_VOICES = _preset_voices_as_dicts()

# Facts-only variant rows (phase ②c): URL sources — the k2-fsa release
# tarballs, sizes HTTP-HEAD-verified 2026-08-14 (the old "~700 MB" claim
# was wrong: the multilingual download is 333 MB). The multilingual row's
# preset count is code-derived from the shipped voices list, never typed.
VARIANTS = [
    {
        "id": "kokoro-multi-lang-v1_0",
        "name": "Kokoro v1.0 multilingual",
        "description": (
            "All preset voices across 8 languages (English, Japanese, "
            "Mandarin, Spanish, French, Hindi, Italian, Portuguese). "
            "Canonical Kokoro model from k2-fsa's sherpa-onnx releases."
        ),
        "languages": ["en-US", "en-GB", "ja", "zh", "es", "fr", "hi", "it", "pt-BR"],
        "voice_cloning": False,
        "preset_voices": len(STATIC_VOICES),
        "quality": 95,
        "weights_license": "Apache-2.0",
        "sources": [{
            "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2",
            "size_bytes": 349_418_188,
        }],
    },
    {
        "id": "kokoro-en-v0_19",
        "name": "Kokoro v0.19 English-only",
        "description": (
            "English voices only (American + British). Smaller download for "
            "users who don't need multilingual."
        ),
        "languages": ["en-US", "en-GB"],
        "voice_cloning": False,
        "preset_voices": None,   # ships its own smaller set; not typed here
        "quality": 92,
        "weights_license": "Apache-2.0",
        "sources": [{
            "url": "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2",
            "size_bytes": 319_625_534,
        }],
    },
]
