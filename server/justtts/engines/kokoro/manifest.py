"""Manifest for the Kokoro engine plugin.

Kokoro (via sherpa-onnx-python) is the lightest engine in the catalog —
no torch, no transformers, just the ONNX runtime. 54 preset voices across
8 languages. ~700 MB model download (handled by the host's existing model
installer, not pip).
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
    "~700 MB model download. CUDA / CoreML / DirectML / CPU."
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
    "disk_space_mb": 700,
    "vram_min_mb": 0,        # CPU-friendly
    "gpu_runtimes": ["cuda", "coreml", "directml", "cpu"],
}

# uv pip install steps run against engines/kokoro/.venv.  No torch needed
# — sherpa-onnx ships its own ONNX runtime as a wheel.  numpy comes in via
# justtts-plugin (the host installs that one automatically).
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

MODELS = []

# Voices exposed to the host catalog even when the engine isn't loaded —
# Kokoro's voice list is static (54 presets, no clones). Voice-cloning
# engines (Chatterbox/Qwen3/etc.) leave this empty; their voices live
# in the host's voice store once cloned and don't need static declaration.
from .voices import preset_voices_as_dicts as _preset_voices_as_dicts  # noqa: E402

STATIC_VOICES = _preset_voices_as_dicts()
