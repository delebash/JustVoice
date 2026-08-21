"""Manifest for the Chatterbox engine plugin.

Chatterbox-tts (Resemble AI) declares `torch==2.6.0` and `transformers==5.2.0`
in its metadata. We install it `--no-deps` and supply that list ourselves,
minus the demo-only parts — because a metadata pin is a request to the
INSTALLER, not a requirement of the code: honouring `torch==2.6.0` would drag
this venv's torch down to a release with no Blackwell (RTX 50) kernels and no
ROCm 7 build, which is the cross-platform floor the 2026-08-22 rulings refused.
The code itself is render-proven on torch 2.9.1 through 2.13.0 (research doc
§4). transformers, by contrast, we now install at exactly the 5.2.0 upstream
asks for: the old 4.57.3 was a shared-venv compromise with qwen3 and died with
the shared venv — at 5.2.0 the same render came out FASTER (2.56 s of audio in
10.4 s on CPU, measured 2026-08-22).

The torch step picks the wheel index for the host's GPU tier at install time
(cu126 / cu130 / rocm7.2 — see manager._detect_torch_index_url).
"""

ID = "chatterbox"
NAME = "Chatterbox"

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

# Install order matters — the family torch pin first, then upstream's own
# sub-dependency list (minus the demo-only parts), then chatterbox-tts itself
# with --no-deps so its metadata cannot re-resolve what the two steps above
# just settled.
INSTALL = [
    # THE family torch pin — identical in every engine that installs torch.
    # Agreement is what makes per-engine venvs cheap: uv hardlinks one cached
    # copy into all of them. Measured 2026-08-22 with all five engines
    # installed by the app: the five venvs REPORT 5,284 MB, but deduped
    # against the uv cache they hold links into, they add only 431 MB —
    # 120 MB of it chatterbox's. (A 120 MB DLL in this venv has a link count
    # of 5: four venvs plus the cache entry, one copy on the drive.) Against
    # 18,750 MB if nothing were shared. A single engine on a different torch
    # would add a second full CUDA stack instead: +4.3 GB.
    # `test_engine_constraints.py` fails if the pins ever drift apart.
    {"kind": "torch", "variant": "auto",
     "packages": ["torch==2.13.0", "torchaudio==2.11.0"]},
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
            # Upstream's own pin, installed as declared. It was held at
            # 4.57.3 while qwen3 shared this interpreter; per-engine venvs
            # end that compromise (module docstring has the measurement).
            "transformers==5.2.0",
            "librosa==0.11.0",
            # Named here because this venv is chatterbox's alone. Under the
            # shared venv both arrived via qwen3's step and nobody noticed
            # chatterbox never declared them — exactly the drift class the
            # per-engine model exists to make impossible.
            "soundfile",
            "safetensors",
            # LoRA: train_lora.py builds the adapter, and engine.py loads a
            # trained one back onto t3 at synth.
            "peft>=0.14",
            # DELIBERATELY no numpy pin. The old `numpy<2.0.0` line was the
            # SHARED venv's ceiling, held for numba (librosa's dependency)
            # which refused to import above numpy 2.0. Two things retired it:
            # the shared venv is gone, and on Python 3.13 chatterbox-tts's own
            # marker asks for numpy>=2 — pinning below 2 here would now
            # contradict upstream rather than follow it. Render-proven on
            # numpy 2.5.2 (2026-08-22).
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
    # Turbo architecture, its own HF repo).
    #
    # no_deps STAYS, and it is not a shared-venv leftover: its pyproject pins
    # `torch==2.6.0` (for Python < 3.14) and would drag gradio==6.8.0 along
    # for a demo we never run. Installing with deps here would silently
    # downgrade this venv's torch out of the 2.9–2.13 band the code is proven
    # on and out of Blackwell/ROCm-7 support entirely. The pip step above IS
    # master's dependency list minus gradio.
    #
    # Bump = new SHA in a deliberate PR, re-checking the from_local weight
    # names against the loaders first.
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
            "revision": "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18",
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
            "revision": "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18",
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
            "revision": "749d1c1a46eb10492095d68fbcf55691ccf137cd",
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
            "revision": "71ccd1d0081b430592cea481f4307e764e07bc64",
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
