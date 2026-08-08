# Mastering

Every render can go through a mastering preset on the way out. Mastering applies loudness normalization, true-peak limiting, optional noise-floor gating, and head/tail silence trimming. The result is audio that meets a distribution spec.

## Built-in presets

| Preset | Loudness | True peak | Use case |
|---|---|---|---|
| **ACX** (audiobook) | -20.0 LUFS | -3.5 dBFS | Apple Books / Audible upload |
| **iAudio** | -16.0 LUFS | -1.0 dBFS | Streaming audiobook |
| **Podcast** | -16.0 LUFS | -1.0 dBFS | Apple Podcasts / Spotify |
| **YouTube** | -14.0 LUFS | -1.0 dBFS | YouTube video soundtrack |
| **None** | (no processing) | — | Game voicelines, raw output for further DAW work |

ACX is the strictest — Audible's QC requires every chapter between -23 LUFS and -18 LUFS with a true peak no higher than -3 dB and a noise floor below -60 dB. JustVoice's ACX preset centers your audio in that window with -3.5 dB peak (safety margin against re-encoding overshoots).

## How it runs

JustVoice uses **pyloudnorm** (EBU R128 LUFS) for measurement in the analyzer, and shells out to
**ffmpeg** for the mastering chain itself (`loudnorm`, `dynaudnorm`, `highpass`, `aresample`).
Mastering has never used the effects DSP — the two are independent paths. The chain per render:

1. **Measure** integrated loudness of the rendered WAV.
2. **Normalize** to the preset's target with gain adjustment.
3. **Limit** to the true peak ceiling (look-ahead brickwall).
4. **Trim head / tail silence** to the preset's head_silence + tail_silence values.
5. **Optional noise gate** if the noise floor is configured.

## Where the preset is set

- **Per-project**: the project's detail panel (Projects tab). Audiobook projects
  imported from a manuscript get **ACX** automatically; other kinds start with no
  preset until you pick one.
- There is **no per-chapter mastering override and no per-take re-master
  button** — earlier versions of this page described both, but neither exists in
  the app. Mastering applies when the project is exported/assembled, not on each
  chapter render. (Per-scene **render presets** in Studio are a different thing —
  delivery/effects bundles, not mastering targets; see [render-presets.md](render-presets.md).)

## ACX QC report

For audiobook projects, the QC check measures each rendered chapter's **RMS
loudness window and peak ceiling** — the two ACX technical checks implemented
today. The export checklist lists the remaining ACX items (noise floor,
head/tail silence) as **"not measured yet"** rather than pretending; a failing
chapter shows the failing metric inline. Note the QC currently measures the
*rendered* audio, which is unmastered until export.

## Custom presets

Build your own under Settings → Mastering → Custom. Knobs: target LUFS, true peak, noise floor, head silence, tail silence, normalization mode (peak / LUFS / hybrid). Saved presets appear in every project's preset picker.

## What it doesn't do

Mastering does NOT add reverb, EQ shape, or character — that's [effects.md](effects.md). Mastering is the final spec-meeting pass; effects are creative.
