# SPDX-License-Identifier: MIT
"""Manifest for the Dia engine plugin — Dia2 (Nari Labs).

Replaced Dia 1.6B with Dia2 on 2026-08-17. Dia 1 was served through the
HuggingFace `DiaForConditionalGeneration` integration, which meant a
git-installed transformers main branch that conflicted with
chatterbox-tts==0.1.7's `transformers==5.2.0` pin and forced an isolated venv.
Dia2 ships its own package (`dia2`) with its own loader, so the transformers
main-branch pin is gone.

What the swap buys, all verified against the source rather than the README:

* **Voice cloning.** Dia 1's adapter never read `req.audio_prompt_path` — the
  manifest said so out loud — so a cloned voice pointed at Dia rendered in the
  stock voice. Dia2's `generate()` takes `prefix_speaker_1` / `prefix_speaker_2`
  (`dia2/generation.py::PrefixConfig`), so cloning is real here.
* **A local-load door.** `Dia2.from_local(config_path, weights_path, ...)` lets
  the host point at the speech cache instead of reaching for the HF hub —
  the same door every other engine got in phase ②.

What it does NOT buy, despite the README's framing: **streaming is listed as
"Upcoming" upstream and is not shipped.** Generation still runs to the runtime
config's `max_context_steps` (1500 ≈ 2 minutes). Do not advertise it.

There is no `dia2` package on PyPI (checked 2026-08-17 — 404), so the install
is a git clone of the repo, which carries its own dependency set.
"""

ID = "dia"
NAME = "Dia"
# engine.py loads Dia2-1B unless a variant says otherwise. 1B rather than 2B:
# Dia is the dialogue specialist here, not the quality tier, and 4.3 GB keeps
# it loadable beside another engine on an 8 GB card.
DEFAULT_VARIANT_ID = "dia2-1b"

# Its own venv: dia2 pins its own torch/tokenizers set and would fight
# chatterbox-tts's transformers pin in the shared venv.
ISOLATION = "venv"
# CUDA-only upstream (`Dia2.from_repo(device="cuda")` is the documented path,
# and the sampler leans on cuda graphs). No macOS.
SUPPORTED_OSES = ["windows", "linux"]
DESCRIPTION = (
    "Nari Labs — single-pass multi-speaker dialogue TTS. Uses [S1] / [S2] tags "
    "inside the text to switch speakers, and clones from a reference clip per "
    "speaker. 1B and 2B variants. English; up to ~2 minutes per generation."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": False,
    # Real now, unlike Dia 1: `generate(prefix_speaker_1=…, prefix_speaker_2=…)`
    # is a first-class argument and engine.py passes the reference clip.
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
    {
        "kind": "pip",
        "packages": [
            "soundfile>=0.13.1",
            "huggingface_hub>=0.30.2",
            "safetensors>=0.5.3",
            "numpy<2.0",
        ],
    },
    # No PyPI release — the package is the repo. Its pyproject pulls the rest
    # (transformers for the Mimi codec, tokenizers, einops).
    {"kind": "pip-git", "url": "https://github.com/nari-labs/dia2.git", "ref": "main"},
]

# Facts-only variant rows. Every file list is the PINNED LOAD SET and every
# size is the sum of those files' real bytes, read from the HF API on
# 2026-08-17 (`/api/models/<repo>?blobs=true`). README, .gitattributes and the
# repos' example WAVs are excluded — the loader never opens them.
#
# BOTH variants need a SECOND repo: `dia2_assets.json` in each model repo is
#   {"config": "config.json", "weights": "model.safetensors",
#    "tokenizer": "<the model repo>", "mimi": "kyutai/mimi"}
# so the Mimi audio codec is a separate download. Same multi-source shape TADA
# uses for its codec. Note Mimi is **CC-BY-4.0**, not Apache-2.0 like the Dia2
# weights — the engine ships under the stricter of the two.
_MIMI_SOURCE = {
    "hf_repo": "kyutai/mimi",
    "revision": "main",
    "size_bytes": 384_651_179,
    "files": ["config.json", "model.safetensors", "preprocessor_config.json"],
}

VARIANTS = [
    {
        "id": "dia2-1b",
        "name": "Dia2 1B",
        "description": (
            "Multi-speaker single-pass dialogue ([S1]/[S2] tags) with per-speaker "
            "reference-audio cloning. The default — half the VRAM of 2B."
        ),
        "languages": ["en"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 84,
        "weights_license": "Apache-2.0",
        "sources": [
            {
                "hf_repo": "nari-labs/Dia2-1B",
                "revision": "main",
                "size_bytes": 4_309_852_127,
                "files": [
                    "added_tokens.json", "config.json", "dia2_assets.json",
                    "merges.txt", "model.safetensors", "special_tokens_map.json",
                    "tokenizer.json", "tokenizer_config.json", "vocab.json",
                ],
            },
            _MIMI_SOURCE,
        ],
    },
    {
        "id": "dia2-2b",
        "name": "Dia2 2B",
        "description": (
            "The larger checkpoint — same interface, more parameters. Worth it "
            "when a card can hold 8 GB of weights alongside nothing else."
        ),
        "languages": ["en"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 88,
        "weights_license": "Apache-2.0",
        "sources": [
            {
                "hf_repo": "nari-labs/Dia2-2B",
                "revision": "main",
                "size_bytes": 7_683_100_734,
                "files": [
                    "added_tokens.json", "config.json", "dia2_assets.json",
                    "merges.txt", "model.safetensors", "special_tokens_map.json",
                    "tokenizer.json", "tokenizer_config.json", "vocab.json",
                ],
            },
            _MIMI_SOURCE,
        ],
    },
]

# Dia2 has no preset speakers at all — the voice comes from the reference clip,
# or from the model's own sampling when none is given. Dia 1 exposed one stock
# voice because it could not clone; keeping that row would now be a lie about
# where the voice comes from, so it is gone. Users create voices via
# /v1/voices/clone like every other cloning engine.
STATIC_VOICES = []
