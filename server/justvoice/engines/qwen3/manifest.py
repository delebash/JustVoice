"""Manifest for Qwen3-TTS (CustomVoice variant).

Two paths to install Qwen3-TTS:
- PyPI: `qwen-tts>=0.0.5` (Alibaba's reference package)
- Git: `git+https://github.com/QwenLM/Qwen3-TTS.git` (newer fixes)

Voicebox uses both (PyPI for the stable surface, git for the latest
release-day fixes). We mirror that.

Three checkpoint families, and the split matters — they are not
interchangeable (model cards re-verified 2026-08-15; VoiceDesign added
2026-08-19 from the Qwen Space's own app.py):

- CustomVoice — 9 preset speakers (Vivian, Serena, Uncle Fu, Dylan,
  Eric, Ryan, Aiden, Ono Anna, Sohee) plus the `instruct` field for
  tone/emotion/prosody control over those timbres. It CANNOT clone.
- Base — 3-second voice cloning from a reference clip, and the
  fine-tuning base (LoRA training targets this family). No preset
  speakers.
- VoiceDesign — a voice invented from a prose description via
  `generate_voice_design`; 1.7B only, no reference audio.

Every variant speaks the same 10 languages.

On macOS the same three families run as mlx-community 8-bit MLX exports
through mlx-audio (the roster doc 2026-08-17 §4's recorded Mac route) —
OS-gated variant rows and OS-gated install steps, in this engine's own venv
like every other engine. UNMEASURED on real Apple hardware.
"""

import sys

ID = "qwen3"
NAME = "Qwen3-TTS"
DESCRIPTION = (
    "Alibaba's open-weight TTS, 10 languages. Two checkpoint families: CustomVoice — "
    "9 preset speakers + a natural-language instruct field for style and emotion; Base — "
    "voice cloning from a short reference clip. 1.7 B and 0.6 B sizes (we default to "
    "CustomVoice 1.7 B; 0.6 B for ~half the VRAM). On Apple Silicon the same "
    "families run as 8-bit MLX builds on the Mac GPU."
)
LICENSE = "Apache-2.0"

# No ISOLATION line: own venv on every OS since 2026-08-22. The per-OS split
# that used to live here is now expressed where it belongs — the `oses` filter
# on the INSTALL steps below. Windows/Linux get torch + qwen-tts; macOS gets
# mlx-audio and no torch at all. That the two want different transformers
# versions (mlx-audio >=5.14 vs qwen-tts ==4.57.3) is no longer a conflict to
# arbitrate: they are never in the same environment.

# Declared 2026-08-17, and this one RESOLVES A CONTRADICTION: the manifest
# declared `gpu_runtimes: ["cuda"]` while inheriting the manager's all-three
# default, so it claimed macOS — where CUDA does not exist.
#
# GROUNDS for excluding macOS:
#   - REQUIREMENTS lists cuda and nothing else. No mps anywhere in the
#     manifest or the adapter.
#   - `engine.py`'s dtype branch is CUDA-specific (`torch.cuda.is_bf16_supported()`),
#     and its `attn_implementation=None` comment is about Windows, not Darwin.
#   - `pick_device` would fall through to mps/cpu on a Mac, but nothing here
#     was written for that path and nobody has run it.
#
# macOS re-entered 2026-08-19 through the MLX arm — NOT the torch path.
# The exclusion above still holds for the PyTorch checkpoints; what changed
# is the roster doc §4 route landing: mlx-community 8-bit weights through
# mlx-audio (MIT, 0.5.0), as OS-gated variant rows + an OS-gated install
# step + the adapter's _is_mlx branch. On a Mac the catalog shows ONLY the
# -mlx rows and the install is mlx-audio in the engine's own venv.
# The earlier ONNX idea (romara-labs/xkos/arubeh exports) is
# superseded — MLX is the recorded route and runs the Mac GPU.
SUPPORTED_OSES = ["windows", "linux", "macos"]

CAPABILITIES = {
    "preset_voices": True,
    # Engine-level = the union across variants: Base clones, CustomVoice
    # does not. The per-variant `voice_cloning` flag below is the one the
    # catalog filter reads.
    "voice_cloning": True,
    # The VoiceDesign checkpoint shipped 2026-08-19 (qwen3-vd-1.7b) and
    # the adapter has its generate_voice_design branch — the flag is real
    # again. Per-variant truth lives in capability_details' qwen3-vd row.
    "voice_design": True,
    "instruct_field": True,
    "paralinguistic_tags": True,
    # LoRA fine-tuning on the Base family (engines/qwen3/train_lora.py,
    # adapted from Alexandria's code-verified loop).
    "training": True,
}

REQUIREMENTS = {
    # cuda/rocm are the torch checkpoints (Windows/Linux); mlx is the
    # Apple-Silicon arm — Metal via unified memory, no device arg at all.
    "gpu_runtimes": ["cuda", "rocm", "mlx"],
}

# The torch stack is the Windows/Linux arm; macOS installs mlx-audio
# instead (last step). A step's "oses" key gates it to those platforms —
# no key = everywhere (manager.install_steps filters).
INSTALL = [
    # THE family torch pin — see chatterbox/manifest.py for why every engine
    # names the same versions. Windows/Linux only: the macOS arm of this
    # engine is MLX, which has no torch at all.
    {"kind": "torch", "variant": "auto",
     "packages": ["torch==2.13.0", "torchaudio==2.11.0"],
     "oses": ["windows", "linux"]},
    {
        "kind": "pip",
        "oses": ["windows", "linux"],
        "packages": [
            "transformers>=4.45,<=4.57.6",
            "accelerate>=0.26",
            "huggingface_hub>=0.20",
            "safetensors>=0.4",
            "soundfile>=0.12",
            "librosa>=0.10",
            # LoRA: adapter loading at synth (PeftModel) + train_lora.py.
            "peft>=0.14",
        ],
    },
    {"kind": "pip", "packages": ["qwen-tts>=0.0.5"], "oses": ["windows", "linux"]},
    {"kind": "pip-git", "url": "https://github.com/QwenLM/Qwen3-TTS.git",
     "ref": "022e286b98fb",  # HEAD @ 2026-08-19; bump = deliberate PR
     "oses": ["windows", "linux"]},
    # macOS: the MLX arm. mlx-audio 0.5.0 (MIT, released 2026-08-17,
    # verified 2026-08-19) loads the mlx-community exports and self-routes
    # generate() by checkpoint family. It brings mlx/transformers 5.14+/
    # huggingface_hub itself.
    {"kind": "pip", "packages": ["mlx-audio>=0.5.0,<0.6"], "oses": ["macos"]},
]

# Facts-only variant rows (phase ②c): whole-repo pins minus README /
# .gitattributes (these trees are lean — the backbone + speech_tokenizer +
# tokenizer set), sizes = the real summed bytes, verified 2026-08-14.
# CustomVoice = 9 preset speakers + instruct, NO cloning; Base = clone-only,
# no presets (both model cards, re-verified 2026-08-15 — this file used to
# say CustomVoice cloned too, and the catalog's Cloning filter believed it).
# Ids mirror the engine's QWEN_VARIANT_REPOS map one-for-one.
_QWEN_FILES = [
    "config.json", "generation_config.json", "merges.txt",
    "model.safetensors", "preprocessor_config.json",
    "speech_tokenizer/config.json", "speech_tokenizer/configuration.json",
    "speech_tokenizer/model.safetensors",
    "speech_tokenizer/preprocessor_config.json",
    "tokenizer_config.json", "vocab.json",
]
# The 10 languages every Qwen3-TTS checkpoint speaks, per the model cards
# (zh en ja ko de fr ru pt es it). This list carried 17 until 2026-08-15 —
# ar/tr/nl/pl/vi/th/id were never supported, and it said "pt-BR" for what
# upstream calls "pt". The engine's own `_LANG_NAME` map (engine.py) has
# always had exactly these 10; the manifest was the side that lied.
_QWEN_LANGS = [
    "zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it",
]

# The MLX exports carry the same tree plus a weight-shard index.
_QWEN_MLX_FILES = [*_QWEN_FILES, "model.safetensors.index.json"]

# The exact commit each repo is pinned to — harvested 2026-08-22 with
# server/scripts/harvest_revisions.py; bump = deliberate PR.
#
# These rows carry byte-exact sizes and file lists, and those facts are true
# of a COMMIT, not of a branch. Pinning `main` meant upstream could re-upload
# weights under the same names and the next machine to install would fetch
# different bytes than the ones measured here, with nothing to notice it.
_QWEN_REVISIONS = {
    "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice": "0c0e3051f131929182e2c023b9537f8b1c68adfe",
    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice": "85e237c12c027371202489a0ec509ded67b5e4b5",
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base": "fd4b254389122332181a7c3db7f27e918eec64e3",
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base": "5d83992436eae1d760afd27aff78a71d676296fc",
    "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign": "5ecdb67327fd37bb2e042aab12ff7391903235d3",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit": "41d3337e8b7f2843a75841595fc14e4b9a7a4b96",
    "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit": "049ef77fe8816b536193c0c25f9a214d17921282",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit": "e7dd0585652209fa0d7783659aad4e8a324de11c",
    "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit": "50f45ef0047cde7e84c2ef04326acb8ada2436a7",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit": "f90d617701d9f7f4ca499291e0b57f2b3c2fd2ee",
}


def _qwen_variant(vid, name, repo, size_bytes, quality, presets, description, *,
                  cloning, design=False, oses=None, files=None):
    return {
        "id": vid, "name": name, "description": description,
        "languages": list(_QWEN_LANGS), "voice_cloning": bool(cloning),
        "voice_design": bool(design),
        "preset_voices": presets, "quality": quality,
        "weights_license": "Apache-2.0",
        # Torch rows are Windows/Linux; the -mlx rows pass macos. The
        # catalog door (model_catalog._variant_rows) filters on this.
        "oses": list(oses or ["windows", "linux"]),
        "sources": [{"hf_repo": repo, "revision": _QWEN_REVISIONS[repo],
                     "size_bytes": size_bytes,
                     "files": list(files or _QWEN_FILES)}],
    }

VARIANTS = [
    _qwen_variant("qwen3-cv-1.7b", "Qwen3-TTS CustomVoice 1.7B",
                  "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", 4_520_159_586, 92, 9,
                  "9 premium preset speakers with natural-language style/emotion "
                  "control. No voice cloning — the Base variant clones.",
                  cloning=False),
    _qwen_variant("qwen3-cv-0.6b", "Qwen3-TTS CustomVoice 0.6B",
                  "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", 2_498_383_610, 80, 9,
                  "9 premium preset speakers with natural-language style/emotion "
                  "control. No voice cloning — the Base variant clones. Lower "
                  "quality ceiling, ~3× faster.",
                  cloning=False),
    _qwen_variant("qwen3-base-1.7b", "Qwen3-TTS Base 1.7B (clone-only)",
                  "Qwen/Qwen3-TTS-12Hz-1.7B-Base", 4_544_170_364, 90, 0,
                  "Voice cloning from a 3–10 second reference clip — no preset "
                  "speakers; drops instruct silently.",
                  cloning=True),
    _qwen_variant("qwen3-base-0.6b", "Qwen3-TTS Base 0.6B (clone-only)",
                  "Qwen/Qwen3-TTS-12Hz-0.6B-Base", 2_516_100_892, 78, 0,
                  "Lightweight cloning checkpoint for lower-end hardware.",
                  cloning=True),
    # Size = the summed HF tree (same 11-file set as the other checkpoints),
    # read from the repo listing 2026-08-19. No 0.6B VoiceDesign exists.
    _qwen_variant("qwen3-vd-1.7b", "Qwen3-TTS VoiceDesign 1.7B",
                  "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", 4_520_159_099, 90, 0,
                  "Invents a voice from a prose description — no reference "
                  "audio. Powers Design from words.",
                  cloning=False, design=True),
    # ── macOS (Apple Silicon): the MLX arm ─────────────────────────────
    # Roster doc 2026-08-17 §4's recorded route: mlx-community exports via
    # mlx-audio. 8-bit across the board (4/5/6-bit + bf16 exist upstream;
    # 8-bit is the quality/size point one story can carry). Sizes = the
    # summed HF trees minus README/.gitattributes, read byte-exact
    # 2026-08-19. Quality sits a notch under the torch rows — 8-bit
    # quantization loss is real but unmeasured here.
    _qwen_variant("qwen3-cv-1.7b-mlx", "Qwen3-TTS CustomVoice 1.7B (MLX 8-bit)",
                  "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
                  3_080_138_901, 90, 9,
                  "Apple-Silicon build of CustomVoice 1.7B — 9 preset "
                  "speakers with style/emotion control, on the Mac GPU.",
                  cloning=False, oses=["macos"], files=_QWEN_MLX_FILES),
    _qwen_variant("qwen3-cv-0.6b-mlx", "Qwen3-TTS CustomVoice 0.6B (MLX 8-bit)",
                  "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
                  1_973_572_801, 78, 9,
                  "Apple-Silicon build of CustomVoice 0.6B — lighter and "
                  "faster, lower quality ceiling.",
                  cloning=False, oses=["macos"], files=_QWEN_MLX_FILES),
    _qwen_variant("qwen3-base-1.7b-mlx", "Qwen3-TTS Base 1.7B (MLX 8-bit, clone-only)",
                  "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
                  3_104_156_243, 88, 0,
                  "Apple-Silicon cloning checkpoint — a 3–10 second "
                  "reference clip, no preset speakers.",
                  cloning=True, oses=["macos"], files=_QWEN_MLX_FILES),
    _qwen_variant("qwen3-base-0.6b-mlx", "Qwen3-TTS Base 0.6B (MLX 8-bit, clone-only)",
                  "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
                  1_991_296_593, 76, 0,
                  "Lightweight Apple-Silicon cloning checkpoint.",
                  cloning=True, oses=["macos"], files=_QWEN_MLX_FILES),
    _qwen_variant("qwen3-vd-1.7b-mlx", "Qwen3-TTS VoiceDesign 1.7B (MLX 8-bit)",
                  "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
                  3_080_138_280, 88, 0,
                  "Apple-Silicon build of VoiceDesign — a voice invented "
                  "from a prose description.",
                  cloning=False, design=True, oses=["macos"],
                  files=_QWEN_MLX_FILES),
]

# Plain Load (no variant picked) loads CustomVoice 1.7B — the MLX build
# on a Mac, the PyTorch build elsewhere. The default must be a row this
# machine's catalog can actually see (rows are OS-gated).
DEFAULT_VARIANT_ID = "qwen3-cv-1.7b-mlx" if sys.platform == "darwin" else "qwen3-cv-1.7b"

# Preset speakers shipped with Qwen3-TTS CustomVoice. Static so the host
# catalog can show them before the engine is loaded.
STATIC_VOICES = [
    {"id": "Vivian", "name": "Vivian", "language": "zh", "gender": "female"},
    {"id": "Serena", "name": "Serena", "language": "zh", "gender": "female"},
    {"id": "Uncle_Fu", "name": "Uncle Fu", "language": "zh", "gender": "male"},
    {"id": "Dylan", "name": "Dylan", "language": "zh", "gender": "male"},
    {"id": "Eric", "name": "Eric", "language": "zh", "gender": "male"},
    {"id": "Ryan", "name": "Ryan", "language": "en", "gender": "male"},
    {"id": "Aiden", "name": "Aiden", "language": "en", "gender": "male"},
    {"id": "Ono_Anna", "name": "Ono Anna", "language": "ja", "gender": "female"},
    {"id": "Sohee", "name": "Sohee", "language": "ko", "gender": "female"},
]
