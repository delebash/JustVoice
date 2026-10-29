# Troubleshooting

The cross-cutting problems. Per-feature pages keep their own troubleshooting
tails for anything specific to that surface.

**An AI feature answers 501 "LLM not configured".** The LLM features (speaker
attribution, smart assign, show notes, …) need a provider — set one up under
AI Settings (the sidebar page). TTS itself never needs an LLM.

**Mastering or export answers 503 mentioning ffmpeg.** ffmpeg isn't installed or
isn't on PATH. Install it and restart the server; everything that muxes or
masters audio depends on it.

**Mastering failed — "ffmpeg could not start (Windows error 0xC0000142)".**
Windows refused to start ffmpeg at all, so it never read the chapter. Every line
keeps its take; only the joined, mastered chapter is missing. The server starts
ffmpeg with no console of its own since 2026-10-07 — before that, a server whose
starting terminal had closed hit this on every chapter. If you still see it,
restart the app and press **Retry** on the chapter's strip.

**A model load hangs or you loaded the wrong one.** A speech model's load can
be cancelled: while it loads, its row on AI Settings → Speech shows **Cancel**
(an **Unload** does the same), and a load that is downloading its model first
has a **Cancel** on its bar. Either stops the load where it is — its download
included — and frees the memory it had reserved.

**A model that loaded fine yesterday won't load today.** Something else may be
holding the GPU memory it needs. The load's error message names any other
program holding a sizeable amount; **show apps** on the memory strip's *Other
apps* cell lists them. JustVoice's own speech processes never outlive the app —
see [GPU → The speech runtime never outlives the app](gpu.md#the-speech-runtime-never-outlives-the-app).

**A chapter says "no dialogue found", or every line went to the Narrator.**
Nothing in its text was read as speech. Check Overview → **Speech marks**: Auto
reads double quotes, single quotes, guillemets and German marks, but if the
book mixes them it may pick the wrong one — set it to the book's own style and
re-analyze. That can't re-cut a chapter whose lines you've already edited (a
word changed, a split, a merge): it keeps them. Speech after a dash isn't read
in any setting. See
[Studio → Speech marks](studio.md#speech-marks).

**A line stops with "… failed to load on first use: audio.cpp isn't installed".**
Every voice engine and speech recognition run on one program, the speech
runtime. Install it with **Install** under **Engine: audio.cpp** at the top of
**AI Settings → Speech** — once, for every engine. See
[Engines → The speech runtime](engines.md#the-speech-runtime).

**A render stops with "… this needs the speech runtime update".** This
JustVoice can speak the line — a blended voice, a lexicon's pronunciation on
Kokoro, a Chatterbox Turbo or Nano voice, Japanese, or Chatterbox in Hebrew,
Russian or Chinese — but the speech runtime you have installed is older. Click
**Update to** under **Engine: audio.cpp** on AI Settings → Speech.

**A render stops with "… this isn't in this version's speech runtime yet".**
The line needs something this JustVoice's speech runtime doesn't have at all.
Give the speaker's persona a different voice. See
[Engines → Not available yet](engines.md#not-available-yet).

**A Japanese line stops with "Japanese needs the Japanese dictionary".**
Install **Japanese dictionary (UniDic)** under **Add-ons** on AI Settings →
Speech (45 MB to download, 248 MB once installed). See
[Engines → The speech runtime](engines.md#the-speech-runtime).

**A Pocket TTS clone stops with "… only after you accept Kyutai's terms".**
Pocket TTS clones only once you have accepted Kyutai's terms for it, on this
install. Open a persona's page and pick *Cloned* under Type and Pocket TTS, or
open the Pocket TTS engine on AI Settings → Speech and click **Read and accept**
in its foot; read the terms and accept them. Its preset
voices never need it. See [Engines → Pocket TTS](engines.md#pocket-tts).

**A Pocket TTS line stops with "… speaks English, and this line is German".**
Pocket TTS is one model per language. Load the model for the line's language on
AI Settings → Speech (Pocket TTS German, Italian, Portuguese or Spanish), or give that
speaker a voice on another engine.

**Speech renders slowly since a model moved to the CPU.** Auto puts a model on
the CPU only when it speaks at least 2× real time there, and measures it on
your machine at its first line. If your CPU is slower than that, the next load
takes it back to the graphics card. To keep it on the card regardless, pick
**Graphics card** beside its **Load** on AI Settings → Speech. See
[Engines → Where each model runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu).

**A render stops naming the wrong kind of model.** Qwen3-TTS is three
different models, and a voice belongs to one of them: *"the CustomVoice model
cannot clone — use a Base model for this voice"* (a cloned voice on
CustomVoice), *"the Base model is clone-only — this voice needs a reference
clip"* (a built-in voice on Base), or *"VoiceDesign renders from a voice
description and this voice has none"*. Chatterbox likewise *"speaks only cloned
voices"*. Load the model the voice was made with, or pick a voice made for the
loaded one.

**The speech runtime won't start.** The error quotes the end of the runtime's
own log; the whole log is `audiocpp-server.log`, beside the AI model engine's
logs in your data folder ([Engines → The speech runtime](engines.md#the-speech-runtime)).
A build that doesn't suit the machine (for example the CUDA build after a
graphics-driver problem) can be swapped for another with **Build** under
**Engine settings** on AI Settings → Speech — see
[GPU](gpu.md#which-build-the-runtime-uses). If a file of the runtime went missing
or an antivirus took one, **Reinstall** under **Engine: audio.cpp** downloads it
again. A slow machine that needs longer than a minute to start it can be given
more in **Start timeout (seconds)** under the same Engine settings.

**A line stops with "the speech runtime did not answer within 900 s".** One
request — a line, or a model load — ran longer than the limit. On a slow CPU a
very long line can; split it, or raise **Request timeout (seconds)** under
**Engine settings** on AI Settings → Speech. A transcription always gets at
least three times its recording's length.

**A line stops with "the speech runtime stopped answering".** The runtime
process ended mid-line — most often the graphics card ran out of memory. The
message quotes the end of its log. The next line starts it again; if it keeps
happening, give the model a shorter piece length
([Engines → Long lines](engines.md#long-lines-and-what-a-model-costs)) or run
it on the CPU.

**Restore finished but something looks off.** A restore (Settings → Backups →
Import backup…) replaces the data live and reloads the app. If a view still
shows pre-restore state, reload once more; speech engines are unloaded by a
restore, so load one again from the AI page before generating.

**The window says "Can't reach the JustVoice server".** The app's window
checks its server as it opens and shows this page if the server hasn't answered
within a few seconds — usually because it is still starting (the first start
after an update, or a slow disk). The page keeps asking — every 2 seconds at
first, then less often, up to once a minute, and not while the window is hidden —
and opens the app the moment the server answers, so most of the time you only need
to wait; **Retry** asks at once. If it never opens, the server didn't start —
its log is `logs/justvoice.log` in your data folder. When the app knows why, the
page says it under the message:

- another program holds the port (*Port N is in use by another program — close
  that program, then press Retry.* — **Retry** starts the server again);
- another person signed in to this computer has JustVoice open on the port (*… One
  copy runs at a time: they can quit theirs (its tray icon), then press Retry.*);
- Windows has reserved the port for Hyper-V, WSL or Docker (*Windows has reserved
  port N for another use …*);
- the server stopped as it started (*Its server stopped as it started: …*, with its
  own first error line — a database it couldn't open, a data folder it couldn't use);
- another JustVoice server — a headless one, say — is using the same data folder
  (*… — stop it first.*); see [Run modes](run-modes.md#desktop).

**The first sound after a quiet spell (Mac).** macOS puts an idle audio session to sleep, so the
first playback after a long pause could fail or pop. JustVoice keeps the session open with a
silent looping clip; there is nothing to set up. If the system blocks audio until you interact
with the window, it starts on your first click or key press.

**MCP clients can't find the server.** MCP mounts at `/mcp` on the app port
(17494) whenever the server starts — it is built in (the official MCP SDK
ships with the app), so there is nothing to install. If a client still can't
connect, check the server log for `MCP server failed to mount`. A client
that gets **401** or **403** is being asked for the server's token: with auth
tokens set, `/mcp` needs `Authorization: Bearer <token>` like the rest of the
API (from this machine only when *Require a token even on localhost* is on).
A **404** means the client's session is gone (the server restarted) — it
should start a new one; most clients do that on their own. See
[MCP server](mcp-server.md).

**Dictation won't start.** The Captures tab shows six readiness gates
(microphone permission, engine loaded, hotkey registered, …) — the failing one
is named. Recordings under half a second are discarded by design.

**A render sounds different from last week.** Check the persona that plays
the speaker (an edit to its pace, pitch, gain or effects changes every line it
speaks) and the project's mastering target. The
[QC report](projects.md) will name a loudness drift.

**Generations pile up and disk fills.** Settings → cache for the render cache;
the bulk-delete admin operation ([Run modes](run-modes.md)) clears old
generations safely — dry-run first.
