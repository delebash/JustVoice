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

| Preset | Sounds like | Chain |
|---|---|---|
| **Robotic** | A machine voice: a slow flanging sweep with a metallic ring and a little grit | Chorus (0.35 Hz, depth 0.4, 3 ms, 65% feedback, 55% mix) · EQ mid +5 dB at 1100 Hz (Q 1.6) · Distortion 8 dB drive |
| **Radio** | An old AM set: only the middle of the voice gets through, squeezed flat and driven hot | HP 450 Hz · LP 3200 Hz · Compressor 6:1 / −24 dB (2 ms attack, 150 ms release) · Distortion 12 dB drive |
| **Echo Chamber** | A large, hard-walled room: a wide reverb tail with a repeating echo behind the voice | Reverb (room 0.92, damping 0.18, 38% wet, 72% dry, width 0.9) · Delay 240 ms (40% feedback, 30% mix) |
| **Deep Voice** | Three semitones lower, with more weight in the low end and an evened-out level | Pitch −3 st · EQ low +4 dB at 220 Hz (Q 0.7) · Compressor 2.5:1 / −20 dB (8 ms attack, 200 ms release) |

The built-in values changed on 2026-10-08. A database made before then keeps the earlier
values until it is reset; presets you saved yourself never change.

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

## Edit a chain

A persona's **＋ Edit** (beside **Effects** on its page) opens the chain editor.
The chain runs top to bottom, each step on what the one above it made:

- **The chain** — drag a step by its grip (the six dots left of its name) to
  move it; ↑ and ↓ move it one place too. **Remove** takes it out; **Add
  effect** puts a new one at the bottom with its default settings.
- **A / B it** — type a line (or leave it empty for the stock line), then
  **▶ Dry** plays it with no effects and **▶ Wet** plays the same take through
  the chain as it stands. It is one take, so the only difference you hear is
  the chain — change a setting and press ▶ Wet again to hear the change on the
  same audio. A new line makes a new take; a take is kept for 10 minutes. If the
  persona's voice model isn't loaded, ▶ asks first (**Load & play**), as every
  ▶ does.
- **Order matters** — the editor's reminder: EQ before compression shapes what
  the compressor reacts to; after, it shapes what survives it. Reverb last, or
  you compress the room.

**Save** puts the chain on the persona (still to be saved with the persona's
own **Save**); **Cancel** drops what you changed. Opened from the Effects page
to change a preset, the editor has no **A / B it** — there is no persona to
speak the line.

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
