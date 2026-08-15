# Voices

A **voice** is a TTS profile — the thing the engine actually speaks with. Voices have a type (cloned / preset / designed / blended), an engine binding, gender / age / accent / tone descriptors, optional default-effects chain, and an audio-output-channel routing.

## Types

| Type | Source | Engines |
|---|---|---|
| **Preset** | Pre-shipped with the engine. | Kokoro (54 voices), Qwen3 **CustomVoice** (9 voices), Dia (1 stock voice) |
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

## Per-voice overrides (Tier 2)

Click the ⚙ button on a voice to open the "Tune {voice}" modal. The same engine params Tier 1 (engine defaults) exposes, but scoped to this voice. Includes a **Preview** button that synthesizes with your pending edits without saving — audition first.

Common knobs (Chatterbox):

- `speed_factor` 0.92–1.05 typical narration, >1.1 sounds rushed
- `exaggeration` 0.8–1.0 calm, 1.3 default, 1.4–1.7 emotional
- `cfg_weight` 0.3–0.4 expressive variance, 0.7 locks tightly
- `temperature` 0.7–0.8 consistent, higher = richer prosody

See [engines.md](engines.md) for which params each engine supports.

## Effects + channel routing

Each voice can carry a default **effects chain** (pedalboard — see [effects.md](effects.md)) and an **audio output channel** (see [channels.md](channels.md)) for multi-device routing. These ride along on every render through this voice.
