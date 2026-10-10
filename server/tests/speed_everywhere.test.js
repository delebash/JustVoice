// SPDX-License-Identifier: MIT
// Speed on every engine — switch plan §5, gap 8 (docs/plans/2026-10-02-gap-8-speed.md) — the
// port of tests/test_speed_everywhere.py.
//
// Kokoro and KittenTTS pace themselves. Every other engine renders at its own pace and the
// server time-stretches the finished line (in audiocpp_dsp since 2026-10-07). Generate goes
// through the chapter render's own function, so its Speed, Pitch and Gain sound the same from
// both. Python's parametrized test loops over its cases.
//
// The three Generate tests (POST /v1/generate) FAIL in Python today: their fake
// `_NowScheduler.submit(specs, interactive=False)` takes no `owner=`, which generate_api has
// passed since 2026-10-07. Here the fake scheduler takes `owner`, so they pass.
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import "./engines_helpers.js";
import * as dspClient from "../src/audio/dsp_client.js";
import { applyEffectsChain, effectsChainHash } from "../src/audio/effects.js";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import { CacheKeyBuilder, packPcmWithFormat } from "../src/cache.js";
import { canonicalJson } from "../src/delivery.js";
import { ExternalOpenAiTtsBackend } from "../src/engines/external_openai.js";
import { EngineRegistry } from "../src/engines/registry.js";
import { applyLineDelivery, probeLineCached, renderLine, speedNative } from "../src/render_core.js";
import * as synthScheduler from "../src/synth_scheduler.js";
import { RENDER_KEY_VERSION } from "../src/version.js";
import { FakeCache, renderState, useManager } from "./render_helpers.js";

afterEach(closeApps);

const SR = 16000;
const N = SR; // one second

function tonePcm(n = N, amp = 0.3, channels = 1) {
  const b = Buffer.alloc(2 * n * channels);
  for (let i = 0; i < n * channels; i++) {
    b.writeInt16LE(Math.trunc(amp * Math.sin((2 * Math.PI * 220.0 * Math.floor(i / channels)) / SR) * 32767), 2 * i);
  }
  return b;
}

const TONE = tonePcm();

function rms(pcm) {
  let s = 0;
  const n = pcm.length / 2;
  for (let i = 0; i < n; i++) s += pcm.readInt16LE(2 * i) ** 2;
  return Math.sqrt(s / n);
}

// ── the stretch itself (in audiocpp_dsp since 2026-10-07) ───────────────

test("the_stretch_is_n_over_factor_long", async () => {
  for (const factor of [0.8, 1.25, 2.0]) {
    expect((await dspClient.shape(TONE, SR, 1, { stretchFactor: factor })).length / 2, String(factor)).toBe(Math.round(N / factor));
  }
});

test("a_speed_outside_the_range_is_clamped_to_it", async () => {
  const silence = Buffer.alloc(2 * N);
  expect((await dspClient.shape(silence, SR, 1, { stretchFactor: 3.0 })).length / 2).toBe(N / 2);
  expect((await dspClient.shape(silence, SR, 1, { stretchFactor: 0.25 })).length / 2).toBe(N * 2);
});

test("a_speed_of_one_never_reaches_the_stretch_and_stereo_keeps_both_channels", async () => {
  expect((await applyLineDelivery(TONE, SR, 1, { speed: 1.0 }, { speedNative: false })).equals(TONE)).toBe(true);
  const stereo = tonePcm(N, 0.3, 2);
  expect((await dspClient.shape(stereo, SR, 2, { stretchFactor: 1.25 })).length / 4).toBe(Math.round(N / 1.25));
});

test("the_stretch_is_not_an_effect", async () => {
  // Effects promise the length they were given; a stretch cannot — a chain entry naming it is
  // skipped like any unknown effect.
  const wav = writeWavContainer(TONE, SR, 1);
  expect((await applyEffectsChain(wav, [{ type: "time_stretch", params: { factor: 2.0 } }])).equals(wav)).toBe(true);
});

// ── which engines pace themselves ───────────────────────────────────────

test("kokoro_and_kitten_pace_themselves_and_the_rest_do_not", () => {
  const st = { engines: new EngineRegistry() };
  expect(speedNative(st, "kokoro") && speedNative(st, "kitten")).toBe(true);
  for (const engineId of ["qwen3", "chatterbox", "pocket", "an-engine-with-no-row"]) {
    expect(speedNative(st, engineId), engineId).toBe(false);
  }
});

test("the_openai_compatible_provider_paces_itself", () => {
  const registry = new EngineRegistry();
  registry.register(new ExternalOpenAiTtsBackend({ id: "oai", name: "OAI", baseUrl: "http://127.0.0.1:1", apiKey: null, model: "m", voices: ["v"] }));
  expect(speedNative({ engines: registry }, "oai")).toBe(true);
});

// ── a chapter line ──────────────────────────────────────────────────────

/** One engine without its own speed (mock-tts) and Kokoro. Both return one second of tone
 * whatever they are asked — the server's stretch is the only thing that can change the length. */
class Manager {
  constructor(current = "mock-tts") {
    const m = (id, voice) => ({ id, kind: "tts", capabilities: { paralinguistic_tags: false }, staticVoices: [{ id: voice, name: voice }] });
    this._m = new Map([
      ["mock-tts", m("mock-tts", "mv_1")],
      ["kokoro", m("kokoro", "af_heart")],
    ]);
    this._voice = { "mock-tts": "mv_1", kokoro: "af_heart" };
    this.synths = [];
    this.current = { tts: current };
  }
  currentId() {
    return this.current.tts ?? null;
  }
  async voices(engineId) {
    return [{ id: this._voice[engineId], name: "V" }];
  }
  getManifest(id) {
    return this._m.get(id) ?? null;
  }
  manifests() {
    return new Map(this._m);
  }
  currentFor(kind) {
    return this.current[kind] ?? null;
  }
  async load(engineId) {
    this.current.tts = engineId;
    return {};
  }
  async synth(engineId, body) {
    this.synths.push([engineId, { ...body }]);
    return [TONE, { sample_rate: SR, channels: 1, is_wav_container: false }];
  }
}

const state = (cache) => renderState({ cache });

/** The key a line had before gap 8 — the delivery hashed as it stood. */
function preGap8Key(engineId, voice, delivery) {
  return new CacheKeyBuilder()
    .withEngine(engineId, RENDER_KEY_VERSION)
    .withVoice(voice)
    .withText("Hi")
    .withLanguage(null)
    .withSeed(null)
    .withDeliveryJson(canonicalJson(delivery))
    .withEffectsChain(effectsChainHash([]))
    .finish();
}

test("a_line_on_an_engine_without_speed_is_stretched", async () => {
  useManager(new Manager());
  const st = state(new FakeCache());
  const dry = await renderLine(st, { voice: "mv_1", text: "Hi", cacheScope: "s" });
  const slow = await renderLine(st, { voice: "mv_1", text: "Hi", delivery: { speed: 0.5 }, cacheScope: "s" });
  expect(dry.pcm.length / 2).toBe(N);
  expect(slow.pcm.length / 2).toBe(2 * N);
});

test("a_kokoro_line_is_paced_by_the_model_not_stretched", async () => {
  const mgr = useManager(new Manager());
  const st = state(new FakeCache());
  const fast = await renderLine(st, { voice: "af_heart", text: "Hi", delivery: { speed: 1.25 }, cacheScope: "s" });
  expect(fast.pcm.length / 2).toBe(N); // the server stretched a line the model already paced
  expect(mgr.synths.at(-1)[1].delivery.speed).toBe(1.25);
});

test("a_line_cached_while_speed_was_ignored_renders_again", async () => {
  const mgr = useManager(new Manager());
  const cache = new FakeCache();
  const st = state(cache);
  cache.put("s", preGap8Key("mock-tts", "mv_1", { speed: 1.25 }), packPcmWithFormat(TONE, SR, 1));
  const line = await renderLine(st, { voice: "mv_1", text: "Hi", delivery: { speed: 1.25 }, cacheScope: "s" });
  expect(mgr.synths.length).toBe(1); // the unstretched entry from before gap 8 was served
  expect(line.pcm.length / 2).toBe(Math.round(N / 1.25));
  // The new entry is the one the probe reports and the next render serves.
  expect(await probeLineCached(st, "mv_1", "Hi", { delivery: { speed: 1.25 }, cacheScope: "s" })).toBe(true);
  await renderLine(st, { voice: "mv_1", text: "Hi", delivery: { speed: 1.25 }, cacheScope: "s" });
  expect(mgr.synths.length).toBe(1);
});

test("kokoro_lines_and_lines_at_their_own_pace_keep_their_cache_entries", async () => {
  const mgr = useManager(new Manager());
  const cache = new FakeCache();
  const st = state(cache);
  cache.put("s", preGap8Key("kokoro", "af_heart", { speed: 1.25 }), packPcmWithFormat(TONE, SR, 1));
  cache.put("s", preGap8Key("mock-tts", "mv_1", { speed: 1.0 }), packPcmWithFormat(TONE, SR, 1));
  await renderLine(st, { voice: "af_heart", text: "Hi", delivery: { speed: 1.25 }, cacheScope: "s" });
  await renderLine(st, { voice: "mv_1", text: "Hi", delivery: { speed: 1.0 }, cacheScope: "s" });
  expect(mgr.synths).toEqual([]);
});

// ── what the server does to a finished line ─────────────────────────────

test("gain_and_pitch_reach_the_audio_and_keep_its_length", async () => {
  const louder = await applyLineDelivery(TONE, SR, 1, { gain_db: 6.0 }, { speedNative: false });
  expect(louder.length).toBe(TONE.length);
  expect(Math.abs(rms(louder) / rms(TONE) / 10 ** (6 / 20) - 1)).toBeLessThan(0.01); // pytest.approx(rel=0.01)
  const higher = await applyLineDelivery(TONE, SR, 1, { pitch: 3 }, { speedNative: false });
  expect(higher.length).toBe(TONE.length);
  expect(higher.equals(TONE)).toBe(false);
});

test("a_speed_the_model_took_is_not_applied_twice", async () => {
  expect((await applyLineDelivery(TONE, SR, 1, { speed: 1.5 }, { speedNative: true })).equals(TONE)).toBe(true);
});

// ── Generate ────────────────────────────────────────────────────────────

/** Runs the one interactive item on the spot. (Python's twin took no `owner=` and so fails
 * today — see the header.) */
const nowScheduler = {
  submit(specs, { interactive = false, owner = null } = {}) {
    void interactive;
    void owner;
    const run = specs[0][1]();
    const handle = {
      items: [{ result: null, error: null }],
      error: null,
      async waitAsync() {
        try {
          handle.items[0].result = await run;
        } catch (e) {
          handle.error = e;
        }
      },
      raiseIfFailed() {
        if (handle.error != null) throw handle.error;
      },
    };
    return handle;
  },
};

/** The app with Generate's manager and scheduler faked (Python's `client` + `gen`). */
async function genApp() {
  const { c } = await appClient();
  const mgr = useManager(new Manager());
  vi.spyOn(synthScheduler, "getScheduler").mockReturnValue(nowScheduler);
  return [c, mgr];
}

/** POST /v1/generate "Hi." → `[sample count, pcm]`. */
async function generate(c, voice, delivery) {
  const r = await c.post("/v1/generate", { json: { voice, text: "Hi.", delivery } });
  expect(r.status, r.text).toBe(200);
  const [fmt, offset, size] = parseWavHeader(r.content);
  return [fmt.sampleCount, r.content.subarray(offset, offset + size)];
}

test("generate_stretches_a_line_on_an_engine_without_speed", async () => {
  const [c] = await genApp();
  const [samples] = await generate(c, "mv_1", { speed: 0.5 });
  expect(samples).toBe(2 * N);
});

test("generate_leaves_kokoros_pacing_to_kokoro", async () => {
  const [c, mgr] = await genApp();
  mgr.current.tts = "kokoro";
  const [samples] = await generate(c, "af_heart", { speed: 1.25 });
  expect(samples).toBe(N);
  expect(Number(mgr.synths.at(-1)[1].delivery.speed)).toBe(1.25);
});

test("generate_applies_gain_and_pitch", async () => {
  const [c] = await genApp();
  const [, louder] = await generate(c, "mv_1", { gain_db: 6.0 });
  expect(Math.abs(rms(louder) / rms(TONE) / 10 ** (6 / 20) - 1)).toBeLessThan(0.01); // pytest.approx(rel=0.01)
  const [, higher] = await generate(c, "mv_1", { pitch: 3 });
  expect(higher.length === TONE.length && !higher.equals(TONE)).toBe(true);
});
