// SPDX-License-Identifier: MIT
// The manager's per-kind activity guard (2026-08-08 §7b P2-6): an unload of a slot WAITS for
// that slot's in-flight synth call to finish before terminating the process (the port of
// tests/test_engine_activity_guard.py — Python's threads are concurrent async calls here).
import { AsyncEvent, sleep } from "@delebash/llm-runner/platform/asyncutil";
import { expect, test } from "vitest";
import { bareManager } from "./engines_helpers.js";

const resp = () => ({
  statusCode: 200,
  headers: { "X-JustVoice-Sample-Rate": "16000", "X-JustVoice-Channels": "1", "content-type": "audio/wav" },
  content: Buffer.from("x"),
});

test("unload_waits_for_inflight_synth", async () => {
  const mgr = bareManager();
  const events = [];
  const release = new AsyncEvent();
  mgr._loaded.set("tts", {
    manifest: { id: "fake", kind: "tts" },
    isAlive: () => true,
    async post(p) {
      events.push(["post-start", p]);
      await release.wait(5000);
      events.push(["post-end", p]);
      return resp();
    },
    terminate() {
      events.push(["terminate"]);
    },
  });
  const synth = mgr.synth("fake", {});
  for (let i = 0; i < 200 && !events.some((e) => e[0] === "post-start"); i++) await sleep(10);
  expect(events).toContainEqual(["post-start", "/synth"]);
  const unload = mgr.unload("tts");
  await sleep(150);
  // The guard holds: no terminate while the synth call is in flight.
  expect(events).not.toContainEqual(["terminate"]);
  release.set();
  await synth;
  await unload;
  const idx = (e) => events.findIndex((x) => JSON.stringify(x) === JSON.stringify(e));
  expect(idx(["post-end", "/synth"])).toBeLessThan(idx(["terminate"]));
});

test("different_kind_is_not_blocked", async () => {
  const mgr = bareManager();
  const release = new AsyncEvent();
  const started = new AsyncEvent();
  mgr._loaded.set("tts", {
    manifest: { id: "fake-tts", kind: "tts" },
    isAlive: () => true,
    async post() {
      started.set();
      await release.wait(5000);
      return resp();
    },
    terminate() {},
  });
  const stt = {
    manifest: { id: "fake-stt", kind: "stt" },
    terminated: false,
    isAlive: () => true,
    terminate() {
      this.terminated = true;
    },
  };
  mgr._loaded.set("stt", stt);
  const synth = mgr.synth("fake-tts", {});
  expect(await started.wait(5000)).toBe(true);
  // A different kind's unload proceeds while tts is mid-synth.
  expect(await mgr.unload("stt")).toEqual({ previous_engine: "fake-stt" });
  expect(stt.terminated).toBe(true);
  release.set();
  await synth;
});
