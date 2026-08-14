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
# engine.py loads nari-labs/Dia-1.6B-0626 unconditionally — declare the
# matching catalog variant so the manager records what actually loaded.
DEFAULT_VARIANT_ID = "dia-1.6b"

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

# Facts-only variant row (phase ②c): ONE variant — the repo the engine
# actually loads. The old catalog's second "dia-2-2b" row pointed at a repo
# that does not exist and an id the engine never received: excised. The
# pinned set is the safetensors shard pair + configs (6.4 GB of the 19.3 GB
# repo — dia-v1.pth and pytorch_model.bin are 6.4 GB duplicates each).
VARIANTS = [
    {
        "id": "dia-1.6b",
        "name": "Dia 1.6B",
        "description": "Multi-speaker single-pass dialogue ([S1]/[S2] tags).",
        "languages": ["en"],
        "voice_cloning": True,
        "preset_voices": 1,
        "quality": 85,
        "weights_license": "Apache-2.0",
        "sources": [{
            "hf_repo": "nari-labs/Dia-1.6B-0626",
            "revision": "main",
            "size_bytes": 6_444_717_832,
            "files": [
                "audio_tokenizer_config.json", "config.json",
                "generation_config.json",
                "model-00001-of-00002.safetensors",
                "model-00002-of-00002.safetensors",
                "model.safetensors.index.json", "preprocessor_config.json",
                "special_tokens_map.json", "tokenizer_config.json",
            ],
        }],
    },
]

# Dia is single-speaker by default (multi-speaker with [S1]/[S2] tags inside
# the text). We expose ONE preset voice so the host catalog + Generate
# dropdown can dispatch — there's nothing to choose between, but the user
# needs SOMETHING to click. Voice cloning supplements this via stored voices.
STATIC_VOICES = [
    # Named so it reads as a VOICE — "Dia (default)" made users think Dia
    # was the default engine (user-hit 2026-06-12). The id stays
    # "default" so existing persona/voice references keep working.
    {"id": "default", "name": "Dia stock voice", "language": "en", "gender": ""},
]
