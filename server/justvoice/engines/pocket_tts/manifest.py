# SPDX-License-Identifier: MIT
"""Pocket TTS — CPU voice cloning (Kyutai Labs).

The 2026-08-17 roster decision (*"ok oand the pcket tts swap"*): Pocket
TTS takes the CPU-cloning slot; LuxTTS stays until Pocket is measured
here (add → measure → retire, never the reverse). Facts verified
2026-08-21 against the primary sources — the PyPI wheel itself (2.1.0,
API read from tts_model.py), the HF repo tree (exact bytes), and the HF
model card (weights license):

  * Kyutai Labs (the Moshi team) — github.com/kyutai-labs/pocket-tts
  * CALM architecture, 100M parameters, 6 languages (en fr de pt it es;
    per-language 24-layer variants exist upstream for higher quality)
  * ~6× realtime on 2 CPU cores per the README; ~200 ms to first chunk
  * zero-shot cloning from an audio prompt; voice states export to
    safetensors and reload fast — the roster doc's architectural fit
    with VoiceRecord.embedding (a future wiring, not this integration)
  * NO expressive controls: no emotion, speed, instruct or tags — the
    README lists even pause-by-silence as unsupported. knobs=[] is a
    fact, not an omission.

Windows is UNMEASURED upstream (the README's benchmark is an M4 Mac);
the wheel is pure-Python and torch is the only native dep, so it is
expected to run — measure before retiring LuxTTS, per the decision.
"""

ID = "pocket-tts"
NAME = "Pocket TTS"
KIND = "tts"

DEFAULT_VARIANT_ID = "pocket-tts"
DESCRIPTION = (
    "Voice cloning that runs in realtime on two CPU cores — no graphics "
    "card needed. Clones from a short recording; speaks English, French, "
    "German, Portuguese, Italian and Spanish. 236 MB download. No "
    "expressive controls — what it clones is what you get."
)
LICENSE = "MIT"  # the pocket-tts package (code)
WEIGHTS_LICENSE = "CC-BY-4.0"  # kyutai/pocket-tts model card, read 2026-08-21

# Own venv: torch>=2.5 floor and a beartype-instrumented package tree —
# nothing here should be able to move the shared venv's pins.
ISOLATION = "venv"

SUPPORTED_OSES = ["windows", "linux", "macos"]

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
}

REQUIREMENTS = {
    # CPU is the engine's whole point; torch's cuda/mps/rocm builds run it
    # too, so a GPU box loses nothing by having it.
    "gpu_runtimes": ["cpu", "cuda", "mps", "rocm"],
    # Auto resolves to cpu and the load books no device memory — same
    # policy as Kokoro, and here the README's own benchmark IS the CPU.
    "cpu_adequate": True,
}

INSTALL = [
    # The torch step picks the hardware-right wheel (cu124 / rocm / mps /
    # cpu); 2.6.0 satisfies pocket-tts's >=2.5 floor and matches the
    # family's tested line.
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    {"kind": "pip", "packages": ["pocket-tts==2.1.0"]},
]

# Facts-only variant row. Sizes are the HF API's exact bytes (read
# 2026-08-21): tts_b6369a24.safetensors 235,738,732 + tokenizer.model
# 59,339. The package resolves weights itself through huggingface_hub;
# the engine pins the download under the app's data dir via HF_HOME (the
# family data-location law), so `hf_repo` here is the provenance record
# and the OS gate's row, not a prefetch instruction.
VARIANTS = [
    {
        "id": "pocket-tts",
        "name": "Pocket TTS",
        "description": (
            "CALM 100M — the English config (english_2026-04). Upstream "
            "also publishes per-language 24-layer configs (french_24l, "
            "german_24l, spanish_24l, …); rows for those arrive when "
            "someone needs one, with their own measured bytes."
        ),
        "languages": ["en", "fr", "de", "pt", "it", "es"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 80,
        "weights_license": "CC-BY-4.0",
        "sources": [{
            "hf_repo": "kyutai/pocket-tts",
            "revision": "main",
            "size_bytes": 235_798_071,  # weights 235,738,732 + tokenizer 59,339
            "files": ["tts_b6369a24.safetensors", "tokenizer.model"],
        }],
    },
]

STATIC_VOICES = []
