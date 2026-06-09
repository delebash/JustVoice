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

JustVoice uses **pyloudnorm** (EBU R128 LUFS) for measurement and **pedalboard** (Spotify's audio-effects lib) for filtering. The chain per render:

1. **Measure** integrated loudness of the rendered WAV.
2. **Normalize** to the preset's target with gain adjustment.
3. **Limit** to the true peak ceiling (look-ahead brickwall).
4. **Trim head / tail silence** to the preset's head_silence + tail_silence values.
5. **Optional noise gate** if the noise floor is configured.

## Per-project + per-chapter

- **Per-project**: set in the project's detail panel. Default for every chapter.
- **Per-chapter**: override via the chapter row's preset dropdown (overrides project default).
- **Per-take**: re-master a take without re-rendering via the "Apply mastering → new version" button (creates a new take with mastering applied; original survives).

## ACX QC report

For audiobook projects with ACX preset, every rendered chapter gets a **QC report** flagging:

- Loudness ≥ -23 LUFS and ≤ -18 LUFS ✓ / ✗
- True peak ≤ -3 dB ✓ / ✗
- Noise floor ≤ -60 dB ✓ / ✗
- Head silence between 0.5s and 1.0s ✓ / ✗
- Tail silence between 1.0s and 5.0s ✓ / ✗

A failed chapter shows the failing metric inline + a "Re-master with safer headroom" button.

## Custom presets

Build your own under Settings → Mastering → Custom. Knobs: target LUFS, true peak, noise floor, head silence, tail silence, normalization mode (peak / LUFS / hybrid). Saved presets appear in every project's preset picker.

## What it doesn't do

Mastering does NOT add reverb, EQ shape, or character — that's [effects.md](effects.md). Mastering is the final spec-meeting pass; effects are creative.
