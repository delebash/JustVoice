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
OS-gated variant rows, an OS-gated install step, and a per-OS venv (see
ISOLATION below). UNMEASURED on real Apple hardware.
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

# Shared venv on Windows/Linux (reuses the torch stack the other engines
# already carry). On macOS the MLX arm gets its OWN venv: mlx-audio 0.5.0
# requires transformers>=5.14 while chatterbox — a shared-venv tenant —
# pins transformers==5.2.0, and sequential installs into one venv are
# last-writer-wins breakage. The Mac venv is small: mlx-audio + deps, no
# torch anywhere in it.
ISOLATION = "venv" if sys.platform == "darwin" else "shared"

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
# -mlx rows and the install is mlx-audio in the engine's own venv (see
# ISOLATION). The earlier ONNX idea (romara-labs/xkos/arubeh exports) is
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
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"],
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
        "sources": [{"hf_repo": repo, "revision": "main",
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
