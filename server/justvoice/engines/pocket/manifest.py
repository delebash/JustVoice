# SPDX-License-Identifier: MIT
"""Manifest for Pocket TTS — Kyutai's 100M cloning model, run by the audio.cpp runtime.

Added with CPU placement (2026-10-02, docs/plans/2026-10-02-cpu-placement.md): the one model
in audio.cpp's catalogue that clones fast enough on the CPU — 4.05× real time on a Ryzen 7
5700X (8 threads), its presets 3.9×. Cloning a low voice (106 Hz) came out at about 96 Hz and
a high one (229 Hz) at 226 Hz, so audio.cpp's copy carries the cloning weights.

Downloaded from audio.cpp's own repo, which needs no login. Kyutai's own cloning repo
(kyutai/pocket-tts) asks for a login and acceptance of its prohibited-use terms; decided
2026-10-02 — "use the copy and show kyutai's terms before first clone": the server refuses a
Pocket render from a reference clip until the user has accepted `TERMS` once (the slot's gate).

One model per language — English, German, Italian, Portuguese, Spanish — each its own download.
The presets speak whichever language's model is loaded; a line in another language is refused
by name. Weights: CC-BY-4.0 (Kyutai).

The presets: 20 of Kyutai's 26, the ones whose recordings permit commercial use (kyutai/
tts-voices README and the pocket-tts card, read 2026-10-02):
  alba — Alba MacKenna, CC BY 4.0 · estelle — Kyutai's own recording, CC0 ·
  anna, azelma, charles, eponine, eve, fantine, george, jane, mary, michael, paul, vera —
  VCTK, CC BY 4.0 · bill_boerst, caro_davy, peter_yearsley, stuart_bell — Voice-Zero, CC0 ·
  javert, marius — Kyutai voice donations, CC0.
Left out: cosette (Expresso) and jean (EARS), both non-commercial; giovanni, lola, juergen and
rafael, whose recordings state no licence. Kyutai gives no gender for them, so none is set.
"""

from ..audiocpp.release import MODEL_REPO, MODEL_REVISION

ID = "pocket"
NAME = "Pocket TTS"

SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "Kyutai's small cloning model — clones a voice from a short clip and speaks 20 preset "
    "voices, fast enough on the CPU. One model per language: English, German, Italian, "
    "Portuguese, Spanish. Runs in the audio.cpp speech runtime."
)
LICENSE = "CC-BY-4.0"
WEIGHTS_LICENSE = "CC-BY-4.0"

CAPABILITIES = {
    "preset_voices": True,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
    "phoneme_override": False,
    "voice_blending": False,
}

REQUIREMENTS = {
    "gpu_runtimes": ["cuda", "vulkan", "metal", "cpu"],
}

# Kyutai's own words, as its gated repo shows them (kyutai/pocket-tts `extra_gated_prompt`,
# read 2026-10-02). `gates`: what is refused until they are accepted.
TERMS = {
    "owner": "Kyutai",
    "title": "Kyutai's terms for Pocket TTS",
    "text": (
        "Prohibited use: Use of our model must comply with all applicable laws and regulations "
        "and must not result in, involve, or facilitate any illegal, harmful, deceptive, "
        "fraudulent, or unauthorized activity. Prohibited uses include, without limitation, "
        "voice impersonation or cloning without explicit and lawful consent; misinformation, "
        "disinformation, or deception (including fake news, fraudulent calls, or presenting "
        "generated content as genuine recordings of real people or events); and the generation "
        "of unlawful, harmful, libelous, abusive, harassing, discriminatory, hateful, or "
        "privacy-invasive content. We disclaim all liability for any non-compliant use."
    ),
    "url": "https://huggingface.co/kyutai/pocket-tts",
    "gates": "cloning",
}

# (our voice id, display name, audio.cpp's name, preset file bytes) — ids carry the engine so
# they never collide with another engine's voice of the same name.
_PRESETS = [
    ("pocket_alba", "Alba", "alba", 6_194_424),
    ("pocket_anna", "Anna", "anna", 7_816_440),
    ("pocket_azelma", "Azelma", "azelma", 7_963_896),
    ("pocket_bill_boerst", "Bill Boerst", "bill_boerst", 6_735_096),
    ("pocket_caro_davy", "Caro Davy", "caro_davy", 5_260_536),
    ("pocket_charles", "Charles", "charles", 6_194_424),
    ("pocket_eponine", "Eponine", "eponine", 6_931_704),
    ("pocket_estelle", "Estelle", "estelle", 8_258_808),
    ("pocket_eve", "Eve", "eve", 6_538_488),
    ("pocket_fantine", "Fantine", "fantine", 6_538_488),
    ("pocket_george", "George", "george", 6_243_576),
    ("pocket_jane", "Jane", "jane", 7_374_072),
    ("pocket_javert", "Javert", "javert", 6_194_424),
    ("pocket_marius", "Marius", "marius", 6_194_424),
    ("pocket_mary", "Mary", "mary", 6_194_424),
    ("pocket_michael", "Michael", "michael", 7_275_768),
    ("pocket_paul", "Paul", "paul", 6_980_856),
    ("pocket_peter_yearsley", "Peter Yearsley", "peter_yearsley", 3_736_816),
    ("pocket_stuart_bell", "Stuart Bell", "stuart_bell", 5_260_536),
    ("pocket_vera", "Vera", "vera", 6_735_096),
]

# Our voice id → the name audio.cpp takes (`engines/audiocpp/slot.py`).
AUDIOCPP_VOICE = {vid: name for vid, _d, name, _b in _PRESETS}

# Listed once, as English — the language of the default model. Loading another language's
# model makes the same presets speak it.
STATIC_VOICES = [{"id": vid, "name": disp, "language": "en", "gender": ""} for vid, disp, _n, _b in _PRESETS]

# (language code, the repo's folder, model file bytes, CPU real-time factor on the reference
# machine — Ryzen 7 5700X, 8 threads, preset alba, the same five lines translated; 2026-10-02).
# Read back by Parakeet: English, German and Italian clean; Portuguese and Spanish sometimes
# drop words, depending on the seed (a long quoted line kept only its last sentence).
_LANGUAGES = [
    ("en", "english", 127_856_704, 3.9),
    ("de", "german", 127_857_184, 3.42),
    ("it", "italian", 127_857_440, 3.57),
    ("pt", "portuguese", 127_858_368, 3.63),
    ("es", "spanish", 127_858_240, 3.62),
]
_NAMES = {"en": "English", "de": "German", "it": "Italian", "pt": "Portuguese", "es": "Spanish"}


def _variant(code: str, folder: str, size: int, cpu_x: float | None) -> dict:
    gguf = f"PocketTTS-GGUF/{folder}/pocket-tts-{folder}-q8_0.gguf"
    presets = [f"PocketTTS-GGUF/{folder}/embeddings/{name}.safetensors" for _v, _d, name, _b in _PRESETS]
    row = {
        "id": f"pocket-{code}-q8",
        "name": f"Pocket TTS {_NAMES[code]}",
        "description": f"Clones a voice from a short clip, and speaks the {len(_PRESETS)} presets, in "
                       f"{_NAMES[code]}. Fast enough on the CPU. 8-bit weights.",
        "languages": [code],
        "voice_cloning": True,
        "preset_voices": len(_PRESETS),
        "weights_license": "CC-BY-4.0",
        "sources": [{"hf_repo": MODEL_REPO, "revision": MODEL_REVISION, "files": [gguf, *presets],
                     "size_bytes": size + sum(b for _v, _d, _n, b in _PRESETS)}],
        # Its clone runs on the plain speech task with a reference clip — audio.cpp's Pocket
        # refuses the clone task (measured 2026-10-02).
        "audiocpp": {"family": "pocket_tts", "task": "tts", "file": gguf},
    }
    if cpu_x is not None:
        row["cpu_realtime"] = cpu_x
    return row


VARIANTS = [_variant(*lang) for lang in _LANGUAGES]

DEFAULT_VARIANT_ID = "pocket-en-q8"
