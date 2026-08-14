"""Manifest for MOSS-TTS (OpenMOSS MOSS-TTSD).

EXPERIMENTAL. No PyPI package; OpenMOSS publishes only the git repo and
expects users to `conda create -n moss_ttsd python=3.12 && pip install -r
requirements.txt && pip install flash-attn`.

Two real concerns the user should know about:
1. **flash-attn** is notoriously hard to install on Windows — it needs
   matching CUDA toolkit + Visual Studio build tools + a long compile.
   On Linux it usually works out of the box.
2. **7B params** model — may OOM on cards smaller than ~10 GB VRAM.

If install fails on Windows, the user's options are:
- Install MOSS-TTS via WSL2 / Linux container (recommended by OpenMOSS).
- Skip MOSS-TTS and use a different engine.

Our install spec attempts the straight Windows / Linux pip install, with
flash-attn as a separate optional step that's allowed to fail (in which
case MOSS won't load but other engines stay healthy).
"""

ID = "moss-tts"
NAME = "MOSS-TTS v1.5"
# Single catalog variant (engine.py loads fnlp/MOSS-TTSD-v0 unconditionally).
DEFAULT_VARIANT_ID = "moss-tts-v1.5"

# MOSS-TTSD requires flash-attn (build deps + CUDA toolkit + long compile)
# and isn't supported on macOS by upstream. Isolated venv keeps the
# flash-attn install attempt from contaminating the shared venv.
ISOLATION = "venv"
SUPPORTED_OSES = ["linux", "windows"]  # macOS hidden — no flash-attn
DESCRIPTION = (
    "OpenMOSS MOSS-TTSD — expressive multi-speaker dialogue, 20 languages, zero-shot voice "
    "cloning from short references. ~7 B params. EXPERIMENTAL: needs flash-attn (build "
    "requires CUDA toolkit + VS build tools on Windows)."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    "single_speaker_dialogue": True,
    "paralinguistic_tags": True,
}

REQUIREMENTS = {
    "disk_space_mb": 12000,
    "gpu_runtimes": ["cuda"],
}

INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    {
        "kind": "pip",
        "packages": [
            "transformers>=4.45,<=4.57.6",
            "accelerate>=0.26",
            "huggingface_hub>=0.20",
            "safetensors>=0.4",
            "soundfile>=0.12",
            "librosa>=0.10",
            "numpy>=1.24,<2.0",
            "einops",
            "scipy",
        ],
    },
    # OpenMOSS doesn't ship a PyPI package — install from the upstream repo.
    {"kind": "pip-git", "url": "https://github.com/OpenMOSS/MOSS-TTSD.git"},
    # flash-attn. May fail on Windows — operator may need to install manually
    # in the engine's venv if this step fails.
    {"kind": "pip", "packages": ["flash-attn>=2.5; sys_platform == 'linux'"]},
]

MODELS = [
    {"hf_repo": "fnlp/MOSS-TTSD-v0", "size_mb": 13000},
]

STATIC_VOICES = []
