# Dictation

JustVoice's dictation turns a recording into text: the local speech recogniser (Qwen3-ASR) transcribes it, and an optional cleanup pass by a language model tidies it.

**Dictate on the Captures tab: press ● Record, speak, press ■ Stop.** The button counts the time while it records. The first time, the app asks to use your microphone (the window's own permission prompt; it records the system's default input). When you stop, the recording goes to the server as a WAV, which transcribes it and cleans it up as this page describes. The transcription runs as a task on the tab's strip, with Cancel and, if it fails, Retry. The new capture then opens in the list. Leaving the tab while it records drops the recording. A recording sent to `POST /v1/captures` from another program is handled the same way and shows on the tab too.

**Not in this release: a global hotkey, and pasting the result into another app** (decided 2026-11-06). Both need research first. The old Tauri shell's hotkey monitor, which the app never turned on, went with Tauri on 2026-10-08, and the Electron shell has none.

The recogniser is the **Transcription** feature's model, set on **AI Settings → Routing by feature**: its card's **Transcription model** — *Transcription — qwen3-asr-1.7b-q8*, Qwen3-ASR 1.7B, as JustVoice ships it — and its **Runs on** (**Auto**, **Graphics card** or **CPU**; see [AI features → Transcription](ai-features.md#transcription)). It runs in the same speech runtime as the voice engines (see [Engines → The speech runtime](engines.md#the-speech-runtime)), so the runtime must be installed; dictation downloads the model the first time it needs it, then loads it. It replaced Whisper on 2026-10-01: on human speech it got fewer words wrong in English, German, French and Russian, about level in Spanish, and somewhat worse in Japanese and Chinese. Unlike Whisper it reports no confidence score.

## Before the first dictation

When a check fails, the Captures tab shows a **Dictation readiness** banner with two checks:

| Check | What it needs |
|---|---|
| The speech recogniser | The speech runtime is installed and the Transcription feature's model is on this computer. As JustVoice ships it, that is Qwen3-ASR 1.7B, 3.6 GB with its word aligner. It loads on first use |
| The cleanup model | The **Dictation cleanup** route resolves to a text-AI model (AI Settings → Routing by feature). Without one, the raw transcript is kept |

The microphone itself is asked for when you first press ● Record. A refused or missing microphone says *Microphone unavailable* and records nothing.

## Hotkeys

**Not in this release.** Nothing listens for a global key, and there is nowhere to set one. Captures' Hotkeys card, which showed fixed chords and an auto-paste switch that did nothing, was removed on 2026-11-06 (Settings → Capture's own went on 2026-10-05).

## Cleanup

After transcription, an optional language-model pass cleans up the text. Whatever the switches below say, it always gives the text capitals and punctuation, and it never answers what you dictated: a question comes back as a question, a request ("write an email to…") as a request. That is all it does on its own — the words stay as you said them. Each change to the words is one of three switches under Settings → Capture → **Cleanup**, each on by default and saved the moment you flip it — the next dictation uses it:

- **Remove filler** — remove filler ("um" / "uh", a "like" that means nothing) and stumbles, and fix a word the recogniser clearly misheard. With it off, the fillers stay in.
- **Take your corrections** — apply mid-sentence corrections you spoke ("she walked to the window — I mean, the door"). Output: "she walked to the door".
- **Keep technical words** — keep proper nouns and technical jargon intact, for code dictation, medical notes and the like.

The same switches sit on AI Settings → Routing by feature, on the **Dictation cleanup** card. (Until 2026-10-05 Settings showed a *Refinement mode* dropdown instead — smart-cleanup, self-correction, preserve-technical — that saved nothing.)

With all three off, a dictation comes back with its words untouched, only written down with capitals and punctuation. The worked examples sent with each dictation follow the switches as well: an example that removes filler or applies a correction is sent only while its switch is on. (Until 2026-10-08 the ground rules removed fillers too, and every example rode along whatever the switches said, so with them off a model still removed fillers and applied corrections.) A database made before then keeps its old cleanup texts until it is reset — or until each text is reset on the Dictation cleanup card — because stored prompt texts are never overwritten.

The model that does the cleanup is whatever the **Dictation cleanup** row on
AI Settings → Routing by feature points at, like every other AI feature — see
[ai-features.md](ai-features.md). Every capture keeps both texts, and the Captures
tab shows the refined transcript with the raw one beneath it.

## Pasting the result

**Not in this release.** Copy a capture's text from its page. Settings → Capture's *Allow auto-paste* switch, which saved nothing, was removed on 2026-10-05.

## Capture sources

● Record records the system's default microphone; the capture is marked **mic**. A program sending a recording to `POST /v1/captures` names its source: `mic`, `system_audio` or `upload` (the default). JustVoice itself doesn't record system audio.

## Captures and your own voice

Every capture lives in the Captures tab, with its length (read from the recording itself since 2026-10-08 — captures made earlier, and a recording that is not a WAV, show none). A recording the recogniser could not transcribe is not kept. The tab can't yet turn a capture into a voice's clip, and has no download: a capture's recording is `GET /v1/captures/{id}/audio`, which you can then use as the clip in a persona's **Clone** (until 2026-11-05 this page described a "→ Sample" button that was never built).

## Capture language

The recogniser detects the language of each recording by default — on clean speech in the languages measured it did as well without a hint as with one. To pin a language (code-switched speech, a lot of jargon), pick it under Settings → Capture → **Capture language** (*Auto-detect* or a language by name); it
saves the moment you pick it, and the Captures page shows what is set (it is the server's `captures.language`, also settable through `PATCH /v1/settings`). A transcription request can also pass its own `language`.
