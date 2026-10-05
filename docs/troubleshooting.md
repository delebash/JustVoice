# Troubleshooting

The cross-cutting problems. Per-feature pages keep their own troubleshooting
tails for anything specific to that surface.

**An AI feature answers 501 "LLM not configured".** The LLM features (speaker
attribution, smart assign, show notes, …) need a provider — set one up under
AI Settings (the sidebar page). TTS itself never needs an LLM.

**Mastering or export answers 503 mentioning ffmpeg.** ffmpeg isn't installed or
isn't on PATH. Install it and restart the server; everything that muxes or
masters audio depends on it.

**A model load hangs or you loaded the wrong one.** Engine loads are
cancellable — the Speech engines tab's load job has a Cancel, and it answers at
once, even mid-load; a cancelled load unloads whatever it had brought in and
frees the memory it had reserved.

**Speech recognition was refused "not enough memory" with itself listed as resident.**
Before 2026-10-04 a model whose runtime process had stopped (downloading another
model restarted it) stayed booked, so reloading it was refused against its own
booking until the app restarted. A stopped model's booking is now freed the
moment JustVoice notices, and downloading a model no longer restarts anything.

**A model that loaded fine yesterday won't load today.** Something else may be
holding the GPU memory it needs. The load's error message names any other
program holding a sizeable amount; speech engines left over from an earlier
session are the usual JustVoice culprit, and the loading screen offers
**Stop them and retry**. See
[GPU → Engines left over from an earlier session](gpu.md#engines-left-over-from-an-earlier-session).

**A chapter says "no dialogue found", or every line went to the Narrator.**
Nothing in its text was read as speech. Check Overview → **Speech marks**: Auto
reads double quotes, single quotes, guillemets and German marks, but if the
book mixes them it may pick the wrong one — set it to the book's own style and
re-analyze. That can't re-cut a chapter whose lines you've already edited (a
word changed, a split, a merge): it keeps them. Speech after a dash isn't read
in any setting. See
[Studio → Speech marks](studio.md#speech-marks).

**A model load says "the speech runtime is not installed yet".** Every voice
engine and speech recognition run on one program, the speech runtime. Install
it from the **Speech runtime** row at the top of **AI Settings → Speech
engines** — once, for every engine. See
[Engines → The speech runtime](engines.md#the-speech-runtime).

**A render stops with "… this needs the speech runtime update".** This
JustVoice can speak the line — a blended voice, a lexicon's pronunciation on
Kokoro, a Chatterbox Turbo or Nano voice, Japanese, or Chatterbox in Hebrew,
Russian or Chinese — but the speech runtime you have installed is older. Click
**Update to** on the runtime row of AI Settings → Speech engines.

**A render stops with "… this isn't in this version's speech runtime yet".**
The line needs something this JustVoice's speech runtime doesn't have at all.
Give the speaker's persona a different voice. See
[Engines → Not available yet](engines.md#not-available-yet).

**A Japanese line stops with "Japanese needs the Japanese dictionary".**
Install the dictionary on its row under the runtime row of AI Settings →
Speech engines (about 260 MB). See
[Engines → The speech runtime](engines.md#the-speech-runtime).

**A Pocket TTS clone stops with "… only after you accept Kyutai's terms".**
Pocket TTS clones only once you have accepted Kyutai's terms for it, on this
install. Open a persona's page, pick *Cloned* under Made by and Pocket TTS, or the Pocket TTS row on AI
Settings → Speech engines, read the terms and click **Accept**. Its preset
voices never need it. See [Engines → The catalog](engines.md#the-catalog).

**A Pocket TTS line stops with "… speaks English, and this line is German".**
Pocket TTS is one model per language. Load the model for the line's language on
Speech engines (Pocket TTS German, Italian, Portuguese or Spanish), or give that
speaker a voice on another engine.

**Speech renders slowly since a model moved to the CPU.** Auto puts a model on
the CPU only when it speaks at least 2× real time there, and measures it on
your machine at its first line. If your CPU is slower than that, the next load
takes it back to the graphics card. To keep it on the card regardless, set its
**Runs on** to **GPU** on Speech engines. See
[Engines → Where each model runs](engines.md#where-each-model-runs--the-graphics-card-or-the-cpu).

**A render stops naming the wrong kind of model.** Qwen3-TTS is three
different models, and a voice belongs to one of them: *"the CustomVoice model
cannot clone — use a Base model for this voice"* (a cloned voice on
CustomVoice), *"the Base model is clone-only — this voice needs a reference
clip"* (a preset speaker on Base), or *"VoiceDesign renders from a voice
description and this voice has none"*. Chatterbox likewise *"speaks only cloned
voices"*. Load the model the voice was made with, or pick a voice made for the
loaded one.

**The speech runtime won't start.** The error quotes the end of the runtime's
own log; the whole log is `logs/audiocpp-server.log` in your data folder. A
build that doesn't suit the machine (for example the CUDA build after a
graphics-driver problem) can be swapped for another on the runtime row's
**Backend** select — see [GPU](gpu.md#which-build-the-runtime-uses). If a file
of the runtime went missing or an antivirus took one, **Reinstall** on the same
row downloads it again. A slow machine that needs longer than a minute to start
it can be given more in `speech_runtime.start_timeout_s`
([Settings reference](settings-reference.md)).

**A line stops with "the speech runtime did not answer within 900 s".** One
request — a line, or a model load — ran longer than the limit. On a slow CPU a
very long line can; split it, or raise `speech_runtime.request_timeout_s`
([Settings reference](settings-reference.md)). A transcription always gets at
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

**MCP clients can't find the server.** MCP mounts at `/mcp` on the app port
(17494) — if it's missing, the server log will say the `fastmcp` package is
absent; install it in the server environment. See [MCP server](mcp-server.md).

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
