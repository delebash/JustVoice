// SPDX-License-Identifier: MIT
// A cloud voice's WAV header decides the rendered line's sample rate (2026-10-02) — the port of
// tests/test_cloud_wav_rate.py.
//
// The providers return `sampleRate: 24000` as a placeholder with the real rate in the WAV header
// (external_openai.js). A chapter render took the placeholder, so a 44.1 kHz WAV would have been
// labelled 24 kHz — slowed and lowered on playback. The chapter render reads the header.
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { EngineMeta, PresetVoice, SynthOutput } from "../src/engines/base.js";
import { EngineRegistry } from "../src/engines/registry.js";
import { renderLine } from "../src/render_core.js";

const SR = 44100;

/** A registry provider whose WAV is 44.1 kHz stereo while its output says 24000 mono. */
class CloudVoice {
  constructor() {
    this.meta = new EngineMeta({ engineId: "cloud", displayName: "Cloud", backend: "cloud", supportedRuntimes: ["http"] });
  }
  ready() {
    return true;
  }
  voices() {
    return [new PresetVoice({ id: "cv_1", name: "CV" })];
  }
  async synthesize() {
    const stereo = Buffer.alloc(SR * 2 * 2);
    for (let i = 0; i < SR; i++) {
      const v = Math.trunc(0.2 * Math.sin((2 * Math.PI * 220 * i) / SR) * 32767);
      stereo.writeInt16LE(v, 4 * i);
      stereo.writeInt16LE(v, 4 * i + 2);
    }
    return new SynthOutput({ bytes: writeWavContainer(stereo, SR, 2), sampleRate: 24000, channels: 1, isWavContainer: true });
  }
}

test("a_chapter_line_takes_the_rate_and_channels_from_the_wav_header", async () => {
  const registry = new EngineRegistry();
  registry.register(new CloudVoice());
  const settings = {
    limits: { text_max_chars: 5000 },
    cache: { enabled: false },
    generation: { max_chunk_chars: 800, crossfade_ms: 50 },
  };
  const st = { settings: { get: () => settings }, engines: registry, voices: { get: () => null }, lexicons: { get: () => null } };
  const line = await renderLine(st, { voice: "cv_1", text: "Hi", useCache: false });
  expect([line.sampleRate, line.channels]).toEqual([SR, 2]);
  expect(line.pcm.length).toBe(SR * 2 * 2); // one second, two channels, 16-bit
});
