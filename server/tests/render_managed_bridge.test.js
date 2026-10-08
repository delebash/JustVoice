// SPDX-License-Identifier: MIT
// The render_core managed bridge (2026-08-08 §7d fix) — the port of
// tests/test_render_managed_bridge.py.
//
// Before the fix, render_line only knew the in-process registry — which holds external cloud
// providers only — so every managed-plugin voice 404'd and the whole multi-line render family
// (chapter, M4B, ZIP, Lines) was cloud-only. These pin the bridge: managed voices resolve via
// manifests, load via the manager, synth via its HTTP proxy, cache like every other line — and
// the registry branch stays first, exactly as external providers and the test fakes rely on.
import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, expect, test } from "vitest";
import "./engines_helpers.js";
import { EngineMeta, PresetVoice, SynthOutput } from "../src/engines/base.js";
import { ApiError } from "../src/errors.js";
import { probeLineCached, renderLine } from "../src/render_core.js";
import { tmpPath } from "./helpers.js";
import { FakeCache, FakeManager, fakeManifest, renderState, useManager } from "./render_helpers.js";

class FakeBackend {
  constructor(engineId, voiceIds) {
    this.meta = new EngineMeta({ engineId, displayName: engineId, backend: "fake", supportedRuntimes: ["cpu"] });
    this._voices = voiceIds.map((v) => new PresetVoice({ id: v, name: v }));
    this.calls = [];
  }
  async load() {}
  unload() {}
  ready() {
    return true;
  }
  voices() {
    return [...this._voices];
  }
  async synthesize(req) {
    this.calls.push(req);
    const b = Buffer.alloc(20);
    for (let i = 0; i < 10; i++) b.writeInt16LE(0x0100, 2 * i);
    return new SynthOutput({ bytes: b, sampleRate: 8000, channels: 1 });
  }
}

let fakeMgr;
beforeEach(() => {
  fakeMgr = useManager(
    new FakeManager({
      "mock-tts": fakeManifest("mock-tts", { tags: false, staticVoices: [{ id: "mv_1", name: "MV" }] }),
      "mock-tags": fakeManifest("mock-tags", { tags: true, staticVoices: [{ id: "tv_1", name: "TV" }] }),
    }),
  );
});

const state = (opts = {}) => renderState({ enabled: opts.cache != null, ...opts });

test("managed_voice_renders_via_manager", async () => {
  const st = state();
  const rl = await renderLine(st, { voice: "mv_1", text: "Hello world" });
  expect(rl.sampleRate).toBe(16000);
  expect(fakeMgr.loads).toEqual([["mock-tts", "auto"]]);
  expect(fakeMgr.synths.length).toBe(1);
  const [engineId, body] = fakeMgr.synths[0];
  expect(engineId).toBe("mock-tts");
  expect(body.voice_id).toBe("mv_1");
});

test("managed_load_skipped_when_current", async () => {
  fakeMgr.current.tts = "mock-tts";
  await renderLine(state(), { voice: "mv_1", text: "Hello" });
  expect(fakeMgr.loads).toEqual([]);
});

test("tag_stripping_follows_manifest_capabilities", async () => {
  const st = state();
  await renderLine(st, { voice: "mv_1", text: "Hello [laugh] world" });
  expect(fakeMgr.synths.at(-1)[1].text).not.toContain("[laugh]");
  await renderLine(st, { voice: "tv_1", text: "Hello [laugh] world" });
  expect(fakeMgr.synths.at(-1)[1].text).toContain("[laugh]");
});

test("managed_lines_cache_and_probe", async () => {
  const st = state({ cache: new FakeCache() });
  expect(await probeLineCached(st, "mv_1", "Hi", { cacheScope: "scene:s1" })).toBe(false);
  await renderLine(st, { voice: "mv_1", text: "Hi", cacheScope: "scene:s1" });
  expect(fakeMgr.synths.length).toBe(1);
  expect(await probeLineCached(st, "mv_1", "Hi", { cacheScope: "scene:s1" })).toBe(true);
  await renderLine(st, { voice: "mv_1", text: "Hi", cacheScope: "scene:s1" });
  expect(fakeMgr.synths.length).toBe(1); // second render was a cache hit
});

test("registry_backend_wins_over_manager", async () => {
  const st = state();
  const backend = new FakeBackend("mock-tts", ["rv_1"]);
  st.engines.register(backend);
  await renderLine(st, { voice: "rv_1", text: "Hello" });
  expect(backend.calls.length).toBe(1);
  expect(fakeMgr.synths).toEqual([]);
});

test("unknown_voice_still_404s", async () => {
  await expect(renderLine(state(), { voice: "nope", text: "Hello" })).rejects.toBeInstanceOf(ApiError);
});

test("cloned_voice_passes_reference_wav", async () => {
  const ref = path.join(tmpPath(), "ref.wav");
  writeFileSync(ref, "RIFF0000WAVE");
  const stored = { id: "v1", engine: "mock-tts", source: "cloned" };
  const voices = { get: (vid) => (vid === "v1" ? stored : null), refWavPath: () => ref };
  await renderLine(state({ voices }), { voice: "v1", text: "Hello" });
  expect(fakeMgr.synths.at(-1)[1].audio_prompt_path).toBe(realpathSync.native(ref));
});
