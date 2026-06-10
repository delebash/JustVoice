# Dictation

JustVoice's dictation feature lets you speak into any text field via a global hotkey. The floating capture pill appears, you talk, the active STT engine transcribes, an optional LLM refines, and the result is pasted into the focused text field.

## STT: local Whisper or an online provider

Transcription is a **provider slot** like TTS and LLM:

- **Local Whisper (the default).** Private and offline. Whisper has its own engine slot, so it coexists with your loaded TTS engine. It **preloads in the background right after boot** ("Preparing dictation" appears briefly in the task strip) so your first Record never waits on a cold start — disable with `captures.preload_stt` if you'd rather it load lazily on first use. Sizes (base → large-v3 → turbo) are picked on the Engines → STT tab; base is realtime on CPU.
- **Online STT.** Register an OpenAI-compatible provider (OpenAI `whisper-1`, Groq `whisper-large-v3`, or a self-hosted faster-whisper server) under Engines → STT → Registered providers, then select it in the **Used for dictation** radio. No local model, no download — readiness is just base URL + key. Audio leaves your machine; that's the trade.

The Captures tab's readiness banner reflects whichever route is active and links to Engines → STT when an online provider is misconfigured.

## 6-gate readiness checklist

Before dictation works end-to-end, all six gates must pass. The Captures tab shows a live status:

| Gate | What's checked |
|---|---|
| 🎙️ Microphone permission | OS-level access to default input |
| ⌨️ Input Monitoring (macOS) | Required to read raw global keystrokes for hotkey detection |
| ♿ Accessibility (macOS) | Required for paste injection (synthesizing Cmd-V) |
| 🤖 STT model | Whisper model downloaded (faster-whisper-base.en by default) |
| 💬 LLM refinement model | Local Qwen 0.6B / 1.7B / 4B downloaded (skip-able if you want raw STT output) |
| ⏯ Push-to-talk chord | Chord configured in Settings → Capture |

Click any failing gate to open the matching System Settings pane (macOS) or fix instructions (Windows / Linux).

## Hotkeys

| Hotkey | Behavior |
|---|---|
| **Push-to-talk** | Hold the chord to record; release to stop + transcribe + paste. Default ⌥⌘V. |
| **Toggle** | Press once to start recording; press again to stop. Default ⌥⌘D. |

Edit chords in Settings → Capture using the ChordPicker (a live keyboard combo editor — press the chord, JustVoice captures the peak set).

## Refinement modes

After Whisper transcription, an optional LLM pass cleans up the output. Three modes:

- **smart-cleanup** — fix obvious errors, expand contractions, remove filler ("um" / "uh"). Default for prose dictation.
- **self-correction** — apply mid-sentence corrections you spoke ("she walked to the window — I mean, the door"). Output: "she walked to the door".
- **preserve-technical** — keep proper nouns + technical jargon intact, don't normalize them. For code dictation, medical notes, etc.

Pick the model size in Settings → Capture → LLM refinement model:

- **Qwen 0.6B** — fastest, CPU-friendly, OK accuracy.
- **Qwen 1.7B** — balanced. Default.
- **Qwen 4B** — best accuracy, requires GPU or strong CPU.
- **Off** — raw Whisper output, no refinement.

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

Whisper auto-detects language by default. Pin to a specific language in Settings → Capture → Capture language if auto-detect picks the wrong one (common with code-switched speech or technical jargon Whisper guesses wrong).
