# Dictation

JustVoice's dictation feature lets you speak into any text field via a global hotkey. The floating capture pill appears, you talk, the local speech recogniser (Qwen3-ASR) transcribes, an optional LLM refines, and the result is pasted into the focused text field.

The recogniser is the **Speech recognition** engine on AI Settings → Speech engines. It runs in the same speech runtime as the voice engines (see [Engines → The speech runtime](engines.md#the-speech-runtime)), so the runtime must be installed and the model downloaded; dictation loads it on first use. It replaced Whisper on 2026-10-01: on human speech it got fewer words wrong in English, German, French and Russian, about level in Spanish, and somewhat worse in Japanese and Chinese. Unlike Whisper it reports no confidence score.

## 6-gate readiness checklist

Before dictation works end-to-end, all six gates must pass. The Captures tab shows a live status:

| Gate | What's checked |
|---|---|
| 🎙️ Microphone permission | OS-level access to default input |
| ⌨️ Input Monitoring (macOS) | Required to read raw global keystrokes for hotkey detection |
| ♿ Accessibility (macOS) | Required for paste injection (synthesizing Cmd-V) |
| 🤖 STT model | The speech-recognition model (Qwen3-ASR 1.7B, 3.6 GB with its word aligner) is downloaded — on AI Settings → Speech engines → Speech recognition |
| 💬 LLM refinement model | The **Dictation cleanup** route resolves to a text-AI model (AI Settings → Routing by feature; skip-able if you want the raw transcript) |
| ⏯ Push-to-talk chord | Chord configured in Settings → Capture |

Click any failing gate to open the matching System Settings pane (macOS) or fix instructions (Windows / Linux).

## Hotkeys

| Hotkey | Behavior |
|---|---|
| **Push-to-talk** | Hold the chord to record; release to stop + transcribe + paste. Default ⌥⌘V. |
| **Toggle** | Press once to start recording; press again to stop. Default ⌥⌘D. |

Edit chords in Settings → Capture using the ChordPicker (a live keyboard combo editor — press the chord, JustVoice captures the peak set).

## Refinement modes

After transcription, an optional LLM pass cleans up the output. Three modes:

- **smart-cleanup** — fix obvious errors, expand contractions, remove filler ("um" / "uh"). Default for prose dictation.
- **self-correction** — apply mid-sentence corrections you spoke ("she walked to the window — I mean, the door"). Output: "she walked to the door".
- **preserve-technical** — keep proper nouns + technical jargon intact, don't normalize them. For code dictation, medical notes, etc.

The model that does the cleanup is whatever the **Dictation cleanup** row on
AI Settings → Routing by feature points at, like every other AI feature — see
[ai-features.md](ai-features.md). Every capture keeps both texts, and the Captures
tab shows the refined transcript with the raw one beneath it.

## Auto-paste

When **Allow auto-paste** is on (Settings → Capture), the refined transcription is written to the clipboard and Cmd-V (macOS) / Ctrl-V (Windows / Linux) is synthesized into the focused window. The previous clipboard contents are restored 500ms after pasting.

Disable auto-paste to just see the refined text in the floating pill — handy when you want to review before committing it anywhere.

## Capture sources

- **Default mic** — your system input.
- **System audio** — the loopback / what's currently playing (good for transcribing a podcast you're listening to, or capturing TTS-engine output from another app).

System-audio capture uses cpal / WASAPI loopback / ScreenCaptureKit depending on OS. macOS 10.15+ required for system audio.

## Promoting captures to voice samples

Every capture lives in the Captures tab. Click "→ Sample" on any row to promote the audio into a Voice profile's reference samples. Useful for cloning your own voice — read aloud for a while, then promote the longest / cleanest captures into a Chatterbox voice.

## Capture language

The recogniser detects the language of each recording by default — on clean speech in the languages measured it did as well without a hint as with one. To pin a language (code-switched speech, a lot of jargon), set the server's capture language, `captures.language`, to a language code through `PATCH /v1/settings`; a transcription request can also pass its own `language`.
