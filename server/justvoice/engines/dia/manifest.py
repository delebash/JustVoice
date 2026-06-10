"""Manifest for the Dia engine plugin.

Dia is Nari Labs' single-pass multi-speaker dialogue TTS. As of 2026-06-08
they don't ship a PyPI package — the canonical install path is the HF
Transformers integration (`pip install transformers` with the main-branch
Dia processor + model classes).

Text format uses `[S1]` / `[S2]` speaker tags. For single-speaker synth
we auto-wrap input text with `[S1]`. For dialogue use `render_chapter`
or multi-line POSTs with explicit tags inside the text.
"""

ID = "dia"
NAME = "Dia"

# Dia pins `triton==3.2.0` (Linux) or `triton-windows==3.2.0.post18` and a
# git-installed transformers main branch. The triton constraint excludes
# macOS entirely (no triton wheels). The git-installed transformers can
# conflict with chatterbox-tts==0.1.7's `transformers==5.2.0` pin in a
# shared venv — so Dia gets its own isolated venv.
ISOLATION = "venv"
SUPPORTED_OSES = ["windows", "linux"]
DESCRIPTION = (
    "Nari Labs — ultra-realistic single-pass multi-speaker dialogue TTS. 1.6B params, "
    "via HuggingFace transformers. Uses [S1] / [S2] tags inside the text to switch "
    "speakers. Voice cloning supported."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": True,
    "single_speaker_dialogue": True,
}

REQUIREMENTS = {
    "disk_space_mb": 6000,
    "vram_min_mb": 10000,
    "gpu_runtimes": ["cuda"],
}

INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    # triton is needed on Linux; Windows uses triton-windows; macOS skips entirely.
    {
        "kind": "pip",
        "packages": [
            "triton==3.2.0; sys_platform == 'linux'",
            "triton-windows==3.2.0.post18; sys_platform == 'win32'",
            "soundfile>=0.13.1",
            "huggingface_hub>=0.30.2",
            "safetensors>=0.5.3",
            "numpy<2.0",
            "pydantic>=2.11",
            "accelerate",
        ],
    },
    # Dia's processor/model classes are in transformers main as of writing —
    # we install from upstream to ensure DiaForConditionalGeneration is available.
    {"kind": "pip-git", "url": "https://github.com/huggingface/transformers.git", "ref": "main"},
]

MODELS = [
    {"hf_repo": "nari-labs/Dia-1.6B-0626", "size_mb": 3200},
]

# Dia is single-speaker by default (multi-speaker with [S1]/[S2] tags inside
# the text). We expose ONE preset voice so the host catalog + Generate
# dropdown can dispatch — there's nothing to choose between, but the user
# needs SOMETHING to click. Voice cloning supplements this via stored voices.
STATIC_VOICES = [
    {"id": "default", "name": "Dia (default)", "language": "en", "gender": ""},
]
