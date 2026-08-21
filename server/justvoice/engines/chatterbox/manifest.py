"""Manifest for the Chatterbox engine plugin.

Chatterbox-tts (Resemble AI) pins torch==2.6.0 / transformers==5.2.0 /
numpy<2.0. In a shared venv these would collide with other engines, hence
the --no-deps + manual-subdep gymnastics in shared-venv installs. In our
subprocess-venv design, chatterbox-tts gets its own venv with exactly its
pinned versions — no --no-deps needed; pip resolves cleanly.

The torch step picks the right CUDA wheel for your GPU at install time,
pinned to torch==2.6.0 so chatterbox's import succeeds.
"""

ID = "chatterbox"
NAME = "Chatterbox"

# Monolithic shared-venv style: chatterbox-tts + its subdeps + torch live
# in the shared venv at engines/.shared-venv/. After the one-time Setup,
# Load is the only button — model weights auto-download via HuggingFace
# cache on first load.
ISOLATION = "shared"
SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "Resemble AI's open-source TTS family. Multilingual variant: 500M params, 23 "
    "languages, zero-shot voice cloning, per-render exaggeration / cfg_weight / "
    "temperature knobs. Apple GPU via a known float32 fix (CPU fallback)."
)
LICENSE = "MIT"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": True,
    "phoneme_override": False,
}

REQUIREMENTS = {
    # mps via the float32 source fix (mps_patch.py — devnen's repair for
    # the stock package's float64 crash); rocm via torch-hip on Linux.
    # Both UNMEASURED on real hardware here.
    "gpu_runtimes": ["cuda", "mps", "cpu", "rocm"],
}

# Install order matters — torch pin first (chatterbox-tts requires 2.6.0
# exactly), then subdeps from the chatterbox-tts requirements list, then
# the package itself. No --no-deps needed because the venv is isolated
# and pip can resolve all the pins simultaneously.
INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    {
        "kind": "pip",
        "packages": [
            "conformer>=0.3.2",
            "diffusers==0.29.0",
            "omegaconf",
            "pykakasi",
            "s3tokenizer",
            "spacy-pkuseg",
            "pyloudnorm",
            "transformers==5.2.0",
            # THE shared venv's numpy ceiling — and the only real one.
            # chatterbox-tts declares numpy<2 for Python < 3.13, and we
            # install it --no-deps so pip never enforces that itself.
            # The other engines' manifests used to carry copies of this
            # pin; none of their packages declares any numpy bound
            # (checked on PyPI 2026-08-19), so the copies are gone.
            "numpy>=1.24.0,<2.0.0",
            "librosa==0.11.0",
            # LoRA: train_lora.py builds the adapter, and engine.py loads a
            # trained one back onto t3 at synth.
            "peft>=0.14",
        ],
    },
    # resemble-perth on PyPI is a NAMESPACE STUB — `import perth; perth.PerthImplicitWatermarker`
    # is None there. Chatterbox's own pyproject pins
    # `resemble-perth @ git+https://github.com/resemble-ai/Perth.git@master` for this reason.
    # We do the same: install Perth from git so the watermarker class is real.
    {"kind": "pip-git", "url": "https://github.com/resemble-ai/Perth.git",
     "ref": "ce86c49d029f"},  # HEAD @ 2026-08-19; bump = deliberate PR
    # Upstream master, pinned (2026-08-19). PyPI stopped at 0.1.7; master
    # (still versioned 0.1.7) adds the v3 multilingual loader
    # (MULTILINGUAL_T3_MODELS maps v2 AND v3) and Chatterbox-Nano (110M,
    # Turbo architecture, its own HF repo). no_deps because its pyproject
    # would drag gradio==6.8.0 (demo-only) and re-resolve torch; the dep
    # list above IS master's list minus gradio (safetensors already in the
    # shared venv via qwen3). Bump = new SHA in a deliberate PR, re-checking
    # the from_local weight names against the loaders first.
    {"kind": "pip-git", "url": "https://github.com/resemble-ai/chatterbox.git",
     "ref": "5de7a54aa4e5e2baadb0182dde554908b48b85c2", "no_deps": True},
]

# Facts-only variant rows (phase ②c, plan doc §12): every file list is the
# PINNED LOAD SET verified against the real HF tree on 2026-08-14, and every
# size is the sum of those files' real bytes. The multilingual list is the
# pinned loader's own allow_patterns verbatim; the turbo list is what
# `from_local` actually reads (the repo's 1,056 MB s3gen.safetensors is NOT
# in turbo's load set — pinning saves the download entirely).
#
# MULTILINGUAL V3 — held back while the install pinned PyPI 0.1.7 (whose
# from_local hardcodes the v2 filename), SHIPPED 2026-08-19 when the install
# moved to upstream master @ 5de7a54: its MULTILINGUAL_T3_MODELS maps "v3"
# and `_construct()` passes the t3 name per variant. One standing caveat
# from the 2026-08-15 file-set verification: master's loader still opens
# `s3gen.pt` for v3, while the repo ALSO carries `s3gen_v3.pt` and
# `s3gen_v3.safetensors` that it never reads — if a future loader starts
# reading the v3 vocoder, the v3 row's file list and sum change.
VARIANTS = [
    {
        "id": "chatterbox-multilingual-v2",
        "name": "Chatterbox Multilingual v2 (500M, 23 langs)",
        "description": (
            "500M-param multilingual covering 23 languages via the request's "
            "`language` field. Emotion exaggeration + CFG controls."
        ),
        "languages": [
            "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi",
            "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv",
            "sw", "tr", "zh",
        ],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 88,
        "weights_license": "MIT",
        "sources": [{
            "hf_repo": "ResembleAI/chatterbox",
            "revision": "main",
            "size_bytes": 3_208_951_748,
            "files": [
                "Cangjie5_TC.json", "conds.pt",
                "grapheme_mtl_merged_expanded_v1.json", "s3gen.pt",
                "t3_mtl23ls_v2.safetensors", "ve.pt",
            ],
        }],
    },
    {
        # Same weights as v2 plus the v3 t3 — only master's loader maps it
        # (MULTILINGUAL_T3_MODELS), which is why this row arrives with the
        # git-pin install. Byte sizes from the HF tree, 2026-08-19.
        "id": "chatterbox-multilingual-v3",
        "name": "Chatterbox Multilingual v3 (500M, 23 langs)",
        "description": (
            "The v3 multilingual t3 — newer training of the same 500M "
            "architecture, same 23 languages and controls. Not heard "
            "side-by-side with v2 here yet; keep v2 until your own ears rule."
        ),
        "languages": [
            "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi",
            "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv",
            "sw", "tr", "zh",
        ],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 88,
        "weights_license": "MIT",
        "sources": [{
            "hf_repo": "ResembleAI/chatterbox",
            "revision": "main",
            "size_bytes": 3_208_951_924,
            "files": [
                "Cangjie5_TC.json", "conds.pt",
                "grapheme_mtl_merged_expanded_v1.json", "s3gen.pt",
                "t3_mtl23ls_v3.safetensors", "ve.pt",
            ],
        }],
    },
    {
        "id": "chatterbox-turbo-v1",
        "name": "Chatterbox Turbo (350M, English)",
        "description": (
            "Streamlined English-only variant. Native paralinguistic tags "
            "([cough], [laugh], [chuckle]). Lower latency; no "
            "exaggeration/CFG knobs."
        ),
        "languages": ["en"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 82,
        "weights_license": "MIT",
        "sources": [{
            "hf_repo": "ResembleAI/chatterbox-turbo",
            "revision": "main",
            "size_bytes": 2_987_680_596,
            "files": [
                "added_tokens.json", "conds.pt", "merges.txt",
                "s3gen_meanflow.safetensors", "special_tokens_map.json",
                "t3_turbo_v1.safetensors", "tokenizer_config.json",
                "ve.safetensors", "vocab.json",
            ],
        }],
    },
    {
        # Turbo's small sibling (upstream #542, on master only): 110M t3 on
        # the Turbo architecture, loaded via ChatterboxTurboTTS(nano=True).
        # Tag vocabulary byte-identical to Turbo's (both added_tokens.json
        # compared 2026-08-19). Upstream positions it for CPU inference;
        # speed and quality UNMEASURED here.
        "id": "chatterbox-nano-v1",
        "name": "Chatterbox Nano (110M, English)",
        "description": (
            "Turbo's architecture at 110M parameters — same 19 inline tags, "
            "aimed at CPU and low-VRAM boxes. Not yet heard here."
        ),
        "languages": ["en"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 78,
        "weights_license": "MIT",
        "sources": [{
            "hf_repo": "ResembleAI/chatterbox-nano",
            "revision": "main",
            "size_bytes": 1_942_108_236,
            "files": [
                "added_tokens.json", "conds.pt", "merges.txt",
                "s3gen_meanflow.safetensors", "special_tokens_map.json",
                "t3_nano_v1.safetensors", "t3_nano_v1.yaml",
                "tokenizer_config.json", "ve.safetensors", "vocab.json",
            ],
        }],
    },
]

# When the user clicks "Load" on the engine row (no specific variant chosen),
# the engine subprocess loads ChatterboxMultilingualTTS from "ResembleAI/chatterbox"
# — which is the multilingual variant. Declaring it here lets the host:
# (a) show "Default model: Chatterbox Multilingual v2" above the variants list, and
# (b) hide that variant from the per-variant Load buttons (since clicking the row's
#     plain Load button already loads it).
DEFAULT_VARIANT_ID = "chatterbox-multilingual-v2"

# Chatterbox is clone-only — no preset voices. The host catalog stays
# empty for this engine; users create voices via /v1/voices/clone.
STATIC_VOICES = []
