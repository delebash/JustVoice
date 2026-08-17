# Voices

A **voice** is a TTS profile — the thing the engine actually speaks with. Voices have a type (cloned / preset / designed / blended), an engine binding, gender / age / accent / tone descriptors, optional default-effects chain, and an audio-output-channel routing.

## Types

| Type | Source | Engines |
|---|---|---|
| **Preset** | Pre-shipped with the engine. | Kokoro (54 voices), Qwen3 **CustomVoice** (9 voices) |
| **Cloned** | Built from one or more reference WAV/MP3 samples you provide. | Chatterbox Turbo + Multilingual, Qwen3 **Base**, LuxTTS, Hume TADA, MOSS-TTSD |
| **Designed** | Described in words, no reference clip. | **Not available yet.** The description is saved on the voice, but no bundled engine can render one — it needs Qwen3's VoiceDesign checkpoint, which JustVoice does not ship. Use Cloned instead. |
| **Blended** | A weighted mix of two or more voices (lerp / slerp / weighted_sum). | Chatterbox |

## Cloning a voice

Five bundled engines clone: **Chatterbox** (Turbo for English, Multilingual
for the other 22 languages), **Qwen3-TTS Base**, **LuxTTS**, **Hume TADA** and
**MOSS-TTSD**. Two do not, whatever a voice's engine binding says: Kokoro
speaks its 54 preset voices, and Qwen3 **CustomVoice** speaks its 9 — point a
cloned voice at CustomVoice and it refuses rather than reading your line in
somebody else's voice.

Drop one or more reference clips into Chatterbox's `voices/` or `reference_audio/` folder, or click "+ Clone new voice" in the Voices tab. JustVoice runs each sample through Whisper for transcription and stores the embedding. Cloned voices appear in the cast picker with a `(clone)` suffix.

Best results: 30 seconds to 2 minutes of clean speech per voice, 16 kHz+, dialogue-style delivery, single speaker, low noise floor.

## Gender + accent + tone tags

Every voice has a gender chip (F / M / N / ❓ / unset) in the library. JustVoice auto-detects from:

- **OpenAI voices**: published canon (Alloy / Echo / Fable / Onyx / Nova / Shimmer / Ash / Coral / Sage / Verse / Ballad).
- **Kokoro voices**: parses the `<region><gender>_<name>` convention (af_alloy = American Female; bm_george = British Male).
- **Cloned / freeform voices**: first-name dictionary (sarah.wav → F, michael.wav → M). Ambiguous names (Alex, Jamie, Riley) deliberately left unset.

Click the chip to cycle through F → M → N → unset → ❓. The override saves on the voice and feeds **Smart-assign** (the LLM voice→character matcher) on subsequent runs.

For the voices the dictionary can't label (the ❓ ones), the toolbar's
**✨ Guess unknown genders** button asks the AI to label them in one batch —
it runs only when you click, applies the confident answers exactly like a
manual chip click, and leaves genuinely ambiguous names unset. (This is the
`voice_gender` feature; its prompt and model live under AI Settings.)

## Hear a voice with your own text

The ▶ button plays a stock sentence — enough to tell two voices apart, not
enough to cast one. **Click the voice's row** and the audition panel opens
underneath it: type the line you actually care about, turn this engine's
knobs, and listen. Nothing is saved; you are auditioning, not editing.

The panel always shows two lines, because auditioning is not free and not
self-evident:

- **What it costs.** JustVoice keeps **one** TTS engine loaded at a time. If
  the voice you clicked belongs to a different engine than the one currently
  resident, the first listen swaps models — which can take a minute. The
  panel says so *before* you click, and names which engine is holding the
  slot. When the engine is already loaded it says that instead, and listens
  are quick.
- **What you're hearing.** A single line naming every layer in play: the
  voice, its engine, and each knob you've moved away from its default. When
  a persona's effects chain or lexicon are part of the picture, they are
  named and marked *(applies on render)* — previews don't run the effects
  chain, and the panel won't pretend otherwise.

Repeat listens of the same line with the same knobs are served from a short
in-memory cache, so tweak-and-compare doesn't re-synthesize what you already
heard. Long text is refused: previews are for a line or two.

Empty the box and the panel falls back to the stock sample.

## Per-voice overrides (Tier 2)

The knobs in the audition panel are for listening — they last as long as the
panel is open. To make a setting **stick**, put it on the persona that uses
the voice ([personas.md](personas.md) → "How they sound" → default delivery
overlay); that is the Tier-2 layer every render reads.

Engine-private knobs used to be an exception here — the audition panel applied
them and the render did not, because the UI saved them flat and the adapters
read them nested. That seam was closed on 2026-08-17: what you audition is now
what you render, for the cross-engine knobs and the engine-private ones alike.

The ⚙ button opens the voice **inspector** (name / gender / language, plus
Train and Blend), not a tuning surface.

Common knobs (Chatterbox Multilingual), with the defaults JustVoice actually
sends:

- `exaggeration` — 0.25–2.0, default **0.5**. Below 0.4 reads flat; above 1.0 is dramatic.
- `cfg_weight` — 0.0–1.0, default **0.5**. Lower loosens pacing, higher holds to the text. Set it to 0 when speaking a language other than the reference clip's.
- `temperature` — default **0.8**. Lower is consistent, higher gives richer prosody.

Chatterbox has **no speed control** — neither variant takes one. Use pitch and
the effects chain, or an engine that does (Kokoro, LuxTTS).

See [engines.md](engines.md) for which params each engine supports.

## Effects + channel routing

Each voice can carry a default **effects chain** (pedalboard — see [effects.md](effects.md)) and an **audio output channel** (see [channels.md](channels.md)) for multi-device routing. These ride along on every render through this voice.
