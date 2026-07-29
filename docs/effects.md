# Effects chain

JustVoice has an effects chain: 10 effect types, 4 built-in presets, custom presets per project.

## Effect types

| Effect | What it does |
|---|---|
| **Pitch shift** | ± 12 semitones. Subtle (1-2 st) for character distinction; extreme (±6+) for monsters / kids / etc. |
| **High-pass filter** | Cut low frequencies. 180 Hz removes rumble; 80 Hz removes only sub-bass. |
| **Low-pass filter** | Cut high frequencies. 4500 Hz for radio voice; 8000 Hz for telephone. |
| **Reverb** | Adds space. Room / hall / chamber / plate variants. Wet/dry mix knob. |
| **Delay** | Echo. Adjustable delay time + feedback. |
| **Chorus** | Doubling effect. Two slightly-detuned copies layered for thickness. |
| **Compressor** | Evens out level. 3:1 ratio at -18 dB threshold is a good starting point. |
| **Gain** | Final level adjustment. ±12 dB. |
| **Distortion** | Soft clipping (tanh waveshaper). Drive in dB — grit and breakup. |
| **EQ (3-band)** | Low shelf · peaking mid · high shelf. Each takes a frequency, gain in dB and a Q. |

## Built-in presets

| Preset | Chain |
|---|---|
| **Radio** | HP 300 Hz · LP 3500 Hz · Compressor 6:1 / -15 dB · Gain +6 dB |
| **Robotic** | Chorus — slow LFO (0.2 Hz), full depth, 35% feedback (a flanger-ish metallic sweep) |
| **Echo Chamber** | Reverb (room 0.85, damping 0.3, 45% wet) · Delay 250 ms (30% feedback, 20% mix) |
| **Deep Voice** | Pitch −3 st · LP 6000 Hz · Compressor 3:1 / −18 dB |

## Non-destructive

Applying an effects chain to a take produces a **new take version** with effects baked in. The original take survives, and `source_take_id` links them. Revert by setting the source take as default. See [take-versioning.md](take-versioning.md).

## Per-voice default chains

Every Voice can carry a default effects chain. Render anything through that voice and the chain applies automatically — useful for character voices that should always sound radio'd (Old Crow over a CB radio) or always thick (a giant character).

## Project + chapter overrides

The chain composes: voice default → persona override → project preset → chapter preset. The lowest-level set value wins. Empty / null at any layer falls through to the next.

## Custom presets

Build a chain in the Effects tab → Save as preset → name it. The preset appears in the project's preset picker and any voice's chain dropdown. Edit / rename / delete from Settings → Effects.

## Engine ignores unknown params

If you apply a Chatterbox-tuned effect chain through OpenAI's external TTS, OpenAI silently ignores params it doesn't understand (rather than erroring). Same for the reverse — applying an OpenAI-only param via Kokoro is a no-op.
