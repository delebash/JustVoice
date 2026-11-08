# Mastering

Every render goes through a mastering preset on the way out. Mastering applies loudness normalization, true-peak limiting, a low-end high-pass, and the head/tail silence a distribution spec asks for. The result is audio that meets that spec.

## Built-in presets

| Preset | Loudness | True peak | Delivers | Use case |
|---|---|---|---|---|
| **ACX** (audiobook) | -20.0 LUFS | -3.5 dBFS | 44.1 kHz mono MP3 192k | Apple Books / Audible upload |
| **iAudio** | -19.0 LUFS | -3.0 dBFS | 44.1 kHz mono MP3 192k | Streaming audiobook |
| **Podcast** | -16.0 LUFS | -1.0 dBFS | 44.1 kHz stereo MP3 128k | Apple Podcasts / Spotify |
| **YouTube** | -14.0 LUFS | -1.0 dBFS | 48 kHz stereo MP3 192k | YouTube video soundtrack |
| **None** | (no processing) | — | — | Game voicelines, raw output for further DAW work |

ACX is the strictest — Audible's QC requires every chapter between -23 LUFS and -18 LUFS with a true peak no higher than -3 dB and a noise floor below -60 dB. JustVoice's ACX preset centers your audio in that window with -3.5 dB peak (safety margin against re-encoding overshoots).

## How it runs

JustVoice runs **FFmpeg** — [its own copy](#ffmpeg) — for the mastering chain (`loudnorm` — EBU R128 loudness and
true peak — `dynaudnorm`, `highpass`, `aresample`); the [ACX check](#acx-qc-report) measures each
chapter's RMS and peak with the app's own analyzer.
Mastering has never used the effects DSP — the two are independent paths. The
ffmpeg chain, in order:

1. **Pad the tail** to the preset's `tail_silence_secs`.
2. **Pad the head** to the preset's `head_silence_secs`. (ACX wants room at
   both ends of a file; the chain adds it, it does not trim what you rendered.)
3. **High-pass at 80 Hz** — rumble and handling noise below speech.
4. **Even out the dynamics** (`dynaudnorm`) — quiet passages come up toward
   the loud ones.
5. **Normalize** to the preset's loudness target and true-peak ceiling
   (`loudnorm` with I / TP / LRA from the preset), then **resample** to the
   preset's sample rate and fold to its channel count. Normalizing comes last
   so the file ends at the preset's numbers: an ACX chapter measures about
   −20 LUFS with its true peak at −3.5 dB. (Until 2026-09-29 the two steps ran
   the other way round, and an "acx" chapter came out at about −17 LUFS with
   its peak near −0.5 dB — mastered, yet failing ACX QC.)

There is **no noise gate** — earlier versions of this page listed one. Noise
floor is a *measurement* the ACX report will grow, not something the chain
applies.

## FFmpeg

Mastering, the chapter masters in **⬇ Chapter WAVs (zip)** and the **M4B** all
run FFmpeg, and the app installs its own: open **AI Settings → FFmpeg** and
click **Install**. It downloads a pinned FFmpeg 9.0.2 build for your computer —
on Windows gyan.dev's *essentials* build (a 115 MB download, about 330 MB
unpacked, ffprobe beside it), on macOS and Linux Martin Riedl's builds (28–34 MB)
— checks it against its SHA-256, and keeps it in the app's models cache under
`ffmpeg/9.0.2/`, where the speech runtime lives too. It is used from the moment
it is there: nothing needs restarting. The same tab has **Update** when a newer
tested build comes with the app, and **Remove**.

**Your own FFmpeg.** Type its full path in the tab's **Your own copy** setting
and the app runs that one instead. If the path stops being there, the app's own
copy stands in. An FFmpeg on your system PATH is never picked up by itself
(until 2026-11-07 it was the only one the app looked for).

**Without one,** nothing fails silently: chapters render raw and the Render
tab's pill says *FFmpeg missing — renders stay raw*; the ACX check measures the
raw render and says so; the chapter zip holds `chapters/` only; the M4B export
answers *FFmpeg isn't installed — required for M4B export. Install it in AI
Settings → FFmpeg.*; and a one-click run says before it starts that it will
stop before the M4B, with an **FFmpeg ➜** link to the tab.

FFmpeg is `GPL-3.0` and is never part of JustVoice's installer — your install
fetches it, the way it fetches the speech runtime (JustVoice's `LICENSES.md`, *Downloaded on
demand*).

## Which preset a render uses

JustVoice picks the target for you, most specific answer first:

1. the **project's** mastering preset — Studio · Overview; audiobook projects
   imported from a manuscript get **ACX** automatically,
2. the **project kind's** default — audiobook → ACX, podcast → Podcast, game
   voicelines → none, custom → none.

**None** at any level means exactly that, and stops the search — turning
mastering off on an audiobook does not fall through to ACX.

Until 2026-08-15 none of this ran: a chapter render only mastered when an API
caller named a preset, and Studio never named one. There is **no per-chapter
override and no per-take re-master button**: the project's target is the
finest grain there is. (Render presets could name one per scene until they were
removed on 2026-10-03.)

A **chapter render** applies the processing and hands you a WAV — you are
auditioning, and the .m4b export should encode once, at the end, not twice.
The encoded deliverable in the preset's own format (ACX's MP3) comes from
**Export**. Mastering needs **FFmpeg** ([above](#ffmpeg)): without it, chapters render raw and the
Render tab's pill says so rather than failing the render.

## ACX QC report

For audiobook projects, the QC check measures each rendered chapter's **RMS
loudness window and peak ceiling** — the two ACX technical checks implemented
today. The export checklist lists the remaining ACX items (noise floor,
head/tail silence) as **"not measured yet"** rather than pretending; a failing
chapter shows the failing metric inline.

QC measures the **mastered** chapter — the audio the export would ship — so a
pass is a statement about the finished book. (It measured the raw render until
2026-08-15, which meant an ACX verdict on audio nobody would ever receive.) On
a machine without FFmpeg the numbers are the raw render's, and the report says
so instead of letting you read them as final.

QC never refuses the whole book. A chapter that can't render yet — lines with
no speaker, a speaker with no persona, or a persona with no voice — is reported as **not ready**
with the reason, and the chapters that *are* finished are still measured. That
matters because a book spends most of its life half-done. The **M4B export**
is the opposite and deliberately so: it stops on the first chapter that isn't
ready, because an audiobook quietly missing lines is worse than one that
refused to build.

## Changing a target's numbers

**Settings → Mastering** shows the four targets — **ACX**, **iAudio**, **Podcast**,
**YouTube**. Pick one to change what it masters to: **Loudness target (LUFS)**,
**True peak ceiling (dBFS)**, **Loudness range (LU)**, **Head silence (s)** and
**Tail silence (s)**. A change is saved when you leave the field, and applies to
every book on that target from its next render. There is no custom target: a
book picks one of the four (or none) on its Overview, under **Mastering target**.

## What it doesn't do

Mastering does NOT add reverb, EQ shape, or character — that's [effects.md](effects.md). Mastering is the final spec-meeting pass; effects are creative.
