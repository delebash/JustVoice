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
# The name matches what actually loads (phase ②c): MOSS-TTSD-v0. The old
# "MOSS-TTS v1.5" name/variant-id described a version that never existed.
NAME = "MOSS-TTSD"
# Single catalog variant (engine.py loads fnlp/MOSS-TTSD-v0 unconditionally).
DEFAULT_VARIANT_ID = "moss-ttsd-v0"

# MOSS-TTSD requires flash-attn (build deps + CUDA toolkit + long compile)
# and isn't supported on macOS by upstream. Isolated venv keeps the
# flash-attn install attempt from contaminating the shared venv.
ISOLATION = "venv"
SUPPORTED_OSES = ["linux", "windows"]  # macOS hidden — no flash-attn

# Marked for removal 2026-08-17, same ruling as TADA.
# WHY: its headline capability has NEVER been reachable. `speaker_prompts`
# exists repo-wide in exactly two places and both are prose — a note string in
# capability_details.py and a comment in models.py. This adapter passes ONE
# `reference_audio` (engine.py:108-115), so [S1]/[S2] both render from the same
# clip. And the architecture could not use it anyway: Block.persona_id is one
# persona per block and render_chapter_api is a per-line loop. Its other claims
# are covered elsewhere — pause tags by host-side pause_before/pause_after
# (every engine), Chinese by Chatterbox Multilingual (which also clones).
# Full reasoning: docs/plans/2026-08-17-engine-roster-and-platform.md §2.8.
DEPRECATED = (
    "Scheduled for removal — its multi-speaker path was never wired, and "
    "JustVoice renders one speaker per line."
)
DESCRIPTION = (
    "OpenMOSS MOSS-TTSD — expressive multi-speaker dialogue (Chinese + English), "
    "zero-shot voice cloning from short references, long stable single-pass "
    "generation. EXPERIMENTAL: needs flash-attn (build requires CUDA toolkit + "
    "VS build tools on Windows)."
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
            "einops",
            "scipy",
        ],
    },
    # OpenMOSS doesn't ship a PyPI package — install from the upstream repo.
    {"kind": "pip-git", "url": "https://github.com/OpenMOSS/MOSS-TTSD.git",
     "ref": "04fe1d8502a6"},  # HEAD @ 2026-08-19; bump = deliberate PR
    # flash-attn. May fail on Windows — operator may need to install manually
    # in the engine's venv if this step fails.
    {"kind": "pip", "packages": ["flash-attn>=2.5; sys_platform == 'linux'"]},
]

# Facts-only variant row (phase ②c): the canonical repo id is
# OpenMOSS-Team/MOSS-TTSD-v0 (the fnlp/ id 307-redirects there); the old
# catalog's "moss-llm/moss-tts-v1.5" repo never existed. Whole lean repo
# pinned, real summed bytes (4.1 GB — the old 13,000 MB claim was invented).
VARIANTS = [
    {
        "id": "moss-ttsd-v0",
        "name": "MOSS-TTSD v0",
        "description": "Expressive zh/en dialogue — long stable single-pass generation.",
        "languages": ["en", "zh"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 90,
        "weights_license": "Apache-2.0",
        "sources": [{
            "hf_repo": "OpenMOSS-Team/MOSS-TTSD-v0",
            "revision": "main",
            "size_bytes": 4_115_408_984,
            "files": [
                "added_tokens.json", "config.json", "generation_config.json",
                "merges.txt", "model.safetensors", "special_tokens_map.json",
                "tokenizer.json", "tokenizer_config.json", "vocab.json",
            ],
        }],
    },
]

STATIC_VOICES = []
