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

## Where a chain lives — two places, and they stack

A chain belongs to a **persona** or to a **render preset**, and nothing else
carries one:

- **The persona's chain** is how a character always sounds — Old Crow over a CB
  radio, a giant always thick. Every line that persona speaks gets it, in every
  render.
- **The render preset's chain** is how a *scene* sounds, and it layers **on top
  of** the persona's: character first, scene colour after. Bind the preset to a
  scene in Studio · Render.

Both run, in that order. This is not a "lowest set value wins" cascade, and
there is no per-voice, per-project or per-chapter chain — earlier versions of
this page described a four-layer merge that the code never had. A **voice** is
the TTS artifact; the styling lives on the persona that speaks with it.

## Where a chain runs

Everywhere audio is made: single-line previews, chapter renders, the audiobook
M4B, and the per-line game voiceline export. (Chapter renders skipped effects
entirely until 2026-08-15 — the editor saved chains and only single-line
previews played them, so the render that mattered came out dry.)

Each rendered line is cached on its chain as well as its text and voice, so
editing one character's reverb re-renders that character's lines and leaves the
rest of the chapter alone. Mastering is a separate, later pass — see
[mastering.md](mastering.md).

## Custom presets

Build a chain in the Effects tab → Save as preset → name it. The preset appears in the project's preset picker and any voice's chain dropdown. Edit / rename / delete from Settings → Effects.

## Engine ignores unknown params

If you apply a Chatterbox-tuned effect chain through OpenAI's external TTS, OpenAI silently ignores params it doesn't understand (rather than erroring). Same for the reverse — applying an OpenAI-only param via Kokoro is a no-op.
