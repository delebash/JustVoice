// SPDX-License-Identifier: MIT
// The effects the chain editor offers (GET /v1/effects/catalog): every effect audiocpp_dsp
// runs — our audio.cpp fork's dsp/src/effects.cpp table, and audio/effects.js's list — with
// each knob's label, its default and its range. Pure data, so the in-app mocks read the list
// the server serves (src/services/mock/effectsChainMock.js).
//
// A default is what the DSP itself uses when a chain leaves the knob out (`param(e, name,
// fallback)` in effects.cpp); a range is what the DSP accepts — where it clamps a value, or
// nothing (null) where it takes any number.

const p = (key, label, dflt, min, max, step) => ({ key, label, type: "number", default: dflt, min, max, step });

export const EFFECT_CATALOG = [
  {
    type: "reverb",
    label: "Reverb",
    description: "Space simulation — room, hall, cathedral.",
    params: [
      p("room_size", "Room size", 0.5, 0.0, 1.0, 0.05),
      p("damping", "Damping", 0.5, 0.0, 1.0, 0.05),
      p("wet_level", "Wet", 0.33, 0.0, 1.0, 0.05),
      p("dry_level", "Dry", 0.4, 0.0, 1.0, 0.05),
      p("width", "Width", 1.0, 0.0, 1.0, 0.05),
    ],
  },
  // effects.cpp `chorus` (2026-10-15 — the DSP ran it, for the built-in Robotic, but the editor
  // could not offer it): the voice's copy is read `centre_delay_ms` behind it, that delay swung
  // up and down `rate_hz` times a second by up to half of itself at full `depth`; `feedback`
  // sends the copy back into itself and `mix` sets how much of it you hear. The DSP clamps depth
  // and mix to 0–1 and feedback to 0–0.95, floors the delay at 0 (under one sample it does
  // nothing) and takes any rate.
  {
    type: "chorus",
    label: "Chorus",
    description: "Doubling effect. Two slightly-detuned copies layered for thickness.",
    params: [
      p("rate_hz", "Rate (Hz)", 1.0, null, null, 0.05),
      p("depth", "Depth", 0.25, 0.0, 1.0, 0.05),
      p("centre_delay_ms", "Centre delay (ms)", 7.0, 0.0, null, 0.5),
      p("feedback", "Feedback", 0.0, 0.0, 0.95, 0.05),
      p("mix", "Mix", 0.5, 0.0, 1.0, 0.05),
    ],
  },
  {
    type: "distortion",
    label: "Distortion",
    description: "Asymmetric saturation — drive in dB.",
    params: [p("drive_db", "Drive (dB)", 25.0, 0.0, 60.0, 1.0)],
  },
  {
    type: "gain",
    label: "Gain",
    description: "Linear level adjust in dB. Use negative for cut.",
    params: [p("gain_db", "Gain (dB)", 0.0, -24.0, 24.0, 0.5)],
  },
  {
    type: "compressor",
    label: "Compressor",
    description: "Reduces dynamic range — broadcast / podcast staple.",
    params: [
      p("threshold_db", "Threshold (dB)", -16.0, -60.0, 0.0, 1.0),
      p("ratio", "Ratio", 2.5, 1.0, 20.0, 0.1),
      p("attack_ms", "Attack (ms)", 1.0, 0.1, 200.0, 0.5),
      p("release_ms", "Release (ms)", 100.0, 10.0, 2000.0, 10.0),
    ],
  },
  {
    type: "pitch_shift",
    label: "Pitch shift",
    description: "Re-pitch in semitones. Wide ranges introduce artefacts.",
    params: [p("semitones", "Semitones", 0.0, -12.0, 12.0, 0.5)],
  },
  {
    type: "delay",
    label: "Delay",
    description: "Echo with feedback.",
    params: [
      p("delay_seconds", "Delay (s)", 0.5, 0.0, 4.0, 0.05),
      p("feedback", "Feedback", 0.0, 0.0, 1.0, 0.05),
      p("mix", "Mix", 0.5, 0.0, 1.0, 0.05),
    ],
  },
  {
    type: "highpass",
    label: "High-pass",
    description: "Cut below cutoff frequency.",
    params: [p("cutoff_frequency_hz", "Cutoff (Hz)", 80.0, 20.0, 2000.0, 10.0)],
  },
  {
    type: "lowpass",
    label: "Low-pass",
    description: "Cut above cutoff frequency.",
    params: [p("cutoff_frequency_hz", "Cutoff (Hz)", 12000.0, 500.0, 20000.0, 100.0)],
  },
  {
    type: "eq_low",
    label: "EQ — Low shelf",
    description: "Boost or cut below cutoff with shelf curve.",
    params: [
      p("cutoff_frequency_hz", "Cutoff (Hz)", 120.0, 20.0, 500.0, 10.0),
      p("gain_db", "Gain (dB)", 0.0, -12.0, 12.0, 0.5),
      p("q", "Q", 0.7, 0.1, 4.0, 0.1),
    ],
  },
  {
    type: "eq_mid",
    label: "EQ — Mid peak",
    description: "Boost or cut around centre frequency.",
    params: [
      p("cutoff_frequency_hz", "Centre (Hz)", 1000.0, 100.0, 8000.0, 50.0),
      p("gain_db", "Gain (dB)", 0.0, -12.0, 12.0, 0.5),
      p("q", "Q", 1.0, 0.1, 4.0, 0.1),
    ],
  },
  {
    type: "eq_high",
    label: "EQ — High shelf",
    description: "Boost or cut above cutoff with shelf curve.",
    params: [
      p("cutoff_frequency_hz", "Cutoff (Hz)", 4000.0, 1000.0, 12000.0, 100.0),
      p("gain_db", "Gain (dB)", 0.0, -12.0, 12.0, 0.5),
      p("q", "Q", 0.7, 0.1, 4.0, 0.1),
    ],
  },
];
