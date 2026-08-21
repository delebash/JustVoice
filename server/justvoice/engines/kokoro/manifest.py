"""Manifest for the Kokoro engine plugin.

Kokoro (via kokoro-onnx) is the lightest engine in the catalog — no torch,
no transformers, just onnxruntime + espeak phonemization. 54 preset voices;
CPU is real-time many times over, GPU optional.

Runtime swapped 2026-08-19: sherpa-onnx → kokoro-onnx (MIT,
github.com/thewh1teagle/kokoro-onnx). Two reasons, both user-visible:

  * `create(text, voice: str | ndarray)` takes a RAW STYLE VECTOR — so a
    blended voice (elementwise weighted average of preset vectors, see
    engines/blending.py) plays instantly, with no repacking and no reload.
    sherpa's wrapper only ever accepted an integer speaker id fixed at
    load time.
  * `lang` is per-call, which closes the "every Kokoro voice speaks
    English" finding — sherpa's wrapper took one language at load.

The voices file is a name-keyed np.load-able pack; the voice ids match
`voices.py` (k2-fsa naming, `<lang><gender>_<name>`).
"""

ID = "kokoro"
NAME = "Kokoro"

# Own venv: kokoro-onnx needs numpy>=2.0.2 while the shared venv's torch
# engines pin numpy<2 (qwen3). The install is tiny (onnxruntime + espeak
# loader), so isolation costs little and dodges the clash entirely.
ISOLATION = "venv"
SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "Kokoro-82M via kokoro-onnx — 54 preset voices, instant blends "
    "(weighted voice mixing), per-line language. 337 MB model download "
    "(model + voice pack, summed from the release's own byte sizes). "
    "No torch: onnxruntime + espeak. CPU is real-time; installing on a "
    "CUDA or DirectML machine adds that GPU runtime, and Apple Silicon "
    "uses CoreML automatically."
)
LICENSE = "MIT"  # kokoro-onnx wrapper; the model weights are Apache-2.0

CAPABILITIES = {
    "preset_voices": True,
    "voice_cloning": False,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
    "phoneme_override": True,
    # Blends are host-side vector math over this engine's voices file
    # (engines/blending.py); the result renders through voice_vector.
    "voice_blending": True,
}

REQUIREMENTS = {
    # onnxruntime execution providers: the base wheel is CPU everywhere and
    # CoreML on macOS; CUDA/DirectML arrive by installing the matching
    # accelerated onnxruntime distribution (kokoro-onnx auto-detects it,
    # and ONNX_PROVIDER overrides).
    "gpu_runtimes": ["cuda", "coreml", "directml", "cpu"],
    # The 2026-08-13 VRAM wiring (Q2's auto policy): Kokoro is real-time on
    # CPU (ONNX, no torch) — `auto` resolves to cpu and the load books no
    # device memory on discrete boxes.
    "cpu_adequate": True,
}

# uv pip install steps run against engines/kokoro/.venv.
INSTALL = [
    {"kind": "pip", "packages": ["kokoro-onnx>=0.6.1"]},
]

# Hardware-conditional runtime arms (manager `_accel_install_step`, added
# 2026-08-21 — before this, CUDA and DirectML were DECLARED above but no
# door ever installed the accelerated onnxruntime build, so choosing
# Device=cuda could only fail). One arm installs, picked by the host's
# detected runtimes in this priority order; each is the door kokoro-onnx's
# own provider detection expects (session.py _ACCELERATED_DISTRIBUTIONS).
# macOS needs no arm — the base onnxruntime wheel already carries CoreML.
ACCEL_INSTALL = {
    "cuda": ["kokoro-onnx[gpu]>=0.6.1"],          # → onnxruntime-gpu
    "directml": ["onnxruntime-directml>=1.20.1"],  # any Windows GPU
}

# Voices exposed to the host catalog even when the engine isn't loaded —
# Kokoro's voice list is static (54 presets, no clones). Voice-cloning
# engines (Chatterbox/Qwen3/etc.) leave this empty; their voices live
# in the host's voice store once cloned and don't need static declaration.
from .voices import preset_voices_as_dicts as _preset_voices_as_dicts  # noqa: E402

STATIC_VOICES = _preset_voices_as_dicts()

# Facts-only variant rows: per-file URL sources from kokoro-onnx's
# model-files-v1.1 GitHub release, sizes read from the release API
# 2026-08-19 (exact bytes, not the page's rounded MB). Both variants share
# the same 54-voice pack.
_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
_VOICES_SRC = {
    "url": f"{_RELEASE}/voices-v1.0.bin",
    "size_bytes": 28_214_398,
    "files": ["voices-v1.0.bin"],
}

VARIANTS = [
    {
        "id": "kokoro-v1.0",
        "name": "Kokoro v1.0",
        "description": (
            "Full-precision Kokoro-82M ONNX. All 54 preset voices; the "
            "canonical choice."
        ),
        "languages": ["en-US", "en-GB", "ja", "zh", "es", "fr", "hi", "it", "pt-BR"],
        "voice_cloning": False,
        "preset_voices": len(STATIC_VOICES),
        "quality": 95,
        "weights_license": "Apache-2.0",
        "sources": [
            {
                "url": f"{_RELEASE}/kokoro-v1.0.onnx",
                "size_bytes": 325_505_369,
                "files": ["kokoro-v1.0.onnx"],
            },
            dict(_VOICES_SRC),
        ],
    },
    {
        "id": "kokoro-v1.0-int8",
        "name": "Kokoro v1.0 int8",
        "description": (
            "Integer-quantized Kokoro-82M — a third of the download, "
            "audibly rougher (the release's own spectral-correlation "
            "figures: 0.874–0.916 against full precision)."
        ),
        "languages": ["en-US", "en-GB", "ja", "zh", "es", "fr", "hi", "it", "pt-BR"],
        "voice_cloning": False,
        "preset_voices": len(STATIC_VOICES),
        "quality": 80,
        "weights_license": "Apache-2.0",
        "sources": [
            {
                "url": f"{_RELEASE}/kokoro-v1.0.int8.onnx",
                "size_bytes": 114_119_327,
                "files": ["kokoro-v1.0.int8.onnx"],
            },
            dict(_VOICES_SRC),
        ],
    },
]

# Plain Load (no variant picked) loads full precision.
DEFAULT_VARIANT_ID = "kokoro-v1.0"
