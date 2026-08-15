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

JustVoice uses **pyloudnorm** (EBU R128 LUFS) for measurement in the analyzer, and shells out to
**ffmpeg** for the mastering chain itself (`loudnorm`, `dynaudnorm`, `highpass`, `aresample`).
Mastering has never used the effects DSP — the two are independent paths. The
ffmpeg chain, in order:

1. **Pad the tail** to the preset's `tail_silence_secs`.
2. **Pad the head** to the preset's `head_silence_secs`. (ACX wants room at
   both ends of a file; the chain adds it, it does not trim what you rendered.)
3. **High-pass at 80 Hz** — rumble and handling noise below speech.
4. **Normalize** to the preset's loudness target and true-peak ceiling
   (`loudnorm` with I / TP / LRA from the preset).
5. **Even out the dynamics** (`dynaudnorm`), then **resample** to the preset's
   sample rate and fold to its channel count.

There is **no noise gate** — earlier versions of this page listed one. Noise
floor is a *measurement* the ACX report will grow, not something the chain
applies.

## Which preset a render uses

JustVoice picks the target for you, most specific answer first:

1. the **render preset** bound to the scene, if it names a master target,
2. the **project's** mastering preset — Projects tab; audiobook projects
   imported from a manuscript get **ACX** automatically,
3. the **project kind's** default — audiobook → ACX, podcast → Podcast, game
   voicelines → none, custom → none.

**None** at any level means exactly that, and stops the search — turning
mastering off on an audiobook does not fall through to ACX.

Until 2026-08-15 none of this ran: a chapter render only mastered when an API
caller named a preset, Studio never named one, and the render preset's master
target was stored and never read. There is still **no per-chapter override and
no per-take re-master button**; a per-scene render preset is the finest grain
there is.

A **chapter render** applies the processing and hands you a WAV — you are
auditioning, and the .m4b export should encode once, at the end, not twice.
The encoded deliverable in the preset's own format (ACX's MP3) comes from
**Export**. Mastering needs **ffmpeg**: without it, chapters render raw and the
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
a machine without ffmpeg the numbers are the raw render's, and the report says
so instead of letting you read them as final.

QC never refuses the whole book. A chapter that can't render yet — lines with
no speaker, or a character with no voice cast — is reported as **not ready**
with the reason, and the chapters that *are* finished are still measured. That
matters because a book spends most of its life half-done. The **M4B export**
is the opposite and deliberately so: it stops on the first chapter that isn't
ready, because an audiobook quietly missing lines is worse than one that
refused to build.

## Custom presets

Build your own under Settings → Mastering → Custom. Knobs: target LUFS, true peak, noise floor, head silence, tail silence, normalization mode (peak / LUFS / hybrid). Saved presets appear in every project's preset picker.

## What it doesn't do

Mastering does NOT add reverb, EQ shape, or character — that's [effects.md](effects.md). Mastering is the final spec-meeting pass; effects are creative.
