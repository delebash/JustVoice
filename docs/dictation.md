# Dictation

JustVoice's dictation turns a recording into text: the local speech recogniser (Qwen3-ASR) transcribes it, and an optional cleanup pass by a language model tidies it.

**Not built yet: starting a recording from the app, and pasting the result.** The global hotkey is not wired — the desktop shell has a hotkey monitor, but the app never turns it on — and the Captures tab's **Record (soon)** button is off. What works today is the server side: a recording sent to `POST /v1/captures` is transcribed and cleaned as this page describes, and appears on the Captures tab. The hotkey, the floating pill and paste-into-any-field are planned; the sections below that describe them say so.

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
| ⏯ Push-to-talk chord | A chord for the global hotkey — not wired yet (see [Hotkeys](#hotkeys)) |

Click any failing gate to open the matching System Settings pane (macOS) or fix instructions (Windows / Linux).

## Hotkeys

**Not wired yet.** The plan is two global chords — **push-to-talk** (hold to record, release to stop and transcribe) and **toggle** (press to start, press again to stop). The desktop shell has the monitor for them, but nothing turns it on, and there is nowhere to set a chord: the Hotkeys card that showed fixed chords in Settings → Capture, with Edit and Clear buttons that did nothing, was removed on 2026-10-05. The idea is in the backlog.

## Cleanup

After transcription, an optional language-model pass cleans up the text. Settings → Capture → **Cleanup** has three switches, each on by default and saved the moment you flip it — the next dictation uses it:

- **Remove filler** — fix obvious errors and remove filler ("um" / "uh").
- **Take your corrections** — apply mid-sentence corrections you spoke ("she walked to the window — I mean, the door"). Output: "she walked to the door".
- **Keep technical words** — keep proper nouns and technical jargon intact, for code dictation, medical notes and the like.

The same switches sit on AI Settings → Routing by feature, on the **Dictation cleanup** card. (Until 2026-10-05 Settings showed a *Refinement mode* dropdown instead — smart-cleanup, self-correction, preserve-technical — that saved nothing.)

The model that does the cleanup is whatever the **Dictation cleanup** row on
AI Settings → Routing by feature points at, like every other AI feature — see
[ai-features.md](ai-features.md). Every capture keeps both texts, and the Captures
tab shows the refined transcript with the raw one beneath it.

## Pasting the result

**Not built yet.** The plan is to paste the cleaned text into the focused window (Cmd-V on macOS, Ctrl-V on Windows and Linux) and put the clipboard back afterwards. Settings → Capture's *Allow auto-paste* switch, which saved nothing, was removed on 2026-10-05; the setting returns when pasting is built.

## Capture sources

- **Default mic** — your system input.
- **System audio** — the loopback / what's currently playing (good for transcribing a podcast you're listening to, or capturing TTS-engine output from another app).

System-audio capture uses cpal / WASAPI loopback / ScreenCaptureKit depending on OS. macOS 10.15+ required for system audio.

## Promoting captures to voice samples

Every capture lives in the Captures tab. Click "→ Sample" on any row to promote the audio into a Voice profile's reference samples. Useful for cloning your own voice — read aloud for a while, then promote the longest / cleanest captures into a Chatterbox voice.

## Capture language

The recogniser detects the language of each recording by default — on clean speech in the languages measured it did as well without a hint as with one. To pin a language (code-switched speech, a lot of jargon), pick it under Settings → Capture → **Capture language** (*Auto-detect* or a language by name); it
saves the moment you pick it, and the Captures page shows what is set (it is the server's `captures.language`, also settable through `PATCH /v1/settings`). A transcription request can also pass its own `language`.
