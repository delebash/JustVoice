# Effects chain

JustVoice has an effects chain: 10 effect types, 4 built-in presets, custom presets per project.

## Effect types

| Effect | What it does |
|---|---|
| **Pitch shift** | ± 12 semitones. Subtle (1-2 st) to tell two personas apart; extreme (±6+) for monsters / kids / etc. |
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

A chain never changes audio you already have. Editing a persona's chain makes
the lines its speakers say [stale](studio.md#stale-lines) in Studio · Render;
rendering them again makes new takes, and the old ones are kept — star one
back to return to it ([Studio → Takes](studio.md#takes)).

## Where a chain lives — on the persona

A chain belongs to a **persona**, and nothing else carries one: it is how that
voice always sounds — Old Crow over a CB radio, a giant always thick. Every
line of every speaker that persona plays gets it, in every render.

There is no per-voice, per-project or per-chapter chain. A **voice** is the TTS
artifact; the styling lives on the persona that speaks with it. (Render presets
carried a second chain layered on top until they were removed on 2026-10-03; a
chapter's own sound — a flashback's reverb, say — comes back with Studio's
scene layer.)

## Where a chain runs

Everywhere audio is made: single-line previews, chapter renders, the audiobook
M4B, and the per-line game voiceline export. (Chapter renders skipped effects
entirely until 2026-08-15 — the editor saved chains and only single-line
previews played them, so the render that mattered came out dry.)

Each take records its chain as well as its text and voice, so editing one
persona's reverb makes the lines of the speakers it plays stale and leaves the
rest of the chapter alone. Mastering is a separate, later pass — see
[mastering.md](mastering.md).

## Custom presets

Build a chain in the Effects tab → Save as preset → name it. The preset appears in the project's preset picker and any voice's chain dropdown. Edit / rename / delete from Settings → Effects.

## Engine ignores unknown params

If you apply a Chatterbox-tuned effect chain through OpenAI's external TTS, OpenAI silently ignores params it doesn't understand (rather than erroring). Same for the reverse — applying an OpenAI-only param via Kokoro is a no-op.
