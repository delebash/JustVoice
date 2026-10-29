// SPDX-License-Identifier: MIT
// The speech runtime never outlives its server (decided 2026-09-29; the runtime since the
// 2026-10-01 switch). Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's
// audio.cpp runtime runs the servers, in the kit's kill-on-close Job Object on Windows
// (`runner/process.spawnChild`), and JustVoice's own leftover sweep and its routes are gone (plan §5
// item 12). What stays ours is POST /v1/shutdown — the desktop shell's close: refused from another
// machine, open to this one without a token (2026-09-30), the kit's runtime servers stopped before
// the server goes (`stopRuntimeServers`), and a stalled exit still ended (the port of
// tests/test_engine_lifetime.py).
import { registerServerStop, cfg as shutdownCfg } from "@delebash/core/platform/shutdown_api";
import { afterEach, expect, test } from "vitest";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";
import { client, closeApps, makeApp } from "./app_helpers.js";

afterEach(async () => {
  endSpeech();
  await closeApps();
});

const SYSTEM_CFG = { ...shutdownCfg };

/** The kit's audio.cpp runtime, faked, its server stop recorded in `stopped`. */
function speechRuntime(stopped) {
  const svc = fakeSpeechRuntime();
  svc.stopServer = async () => {
    stopped.push(true);
  };
  return svc;
}

test("shutdown_is_refused_from_another_machine", async () => {
  const app = await makeApp();
  expect((await client(app, { remoteAddress: "192.168.1.20" }).post("/v1/shutdown")).status).toBe(403);
});

test("shutdown_stops_engines_and_ends_the_server", async () => {
  const app = await makeApp();
  const stopped = [];
  speechRuntime(stopped);
  const timers = [];
  const exits = [];
  // never the real timer: it would end this test run
  shutdownCfg.startTimer = (s, fn) => timers.push([s, fn]);
  shutdownCfg.exit = (code) => exits.push(code);
  const server = { stopped: [], stop: (why) => server.stopped.push(why) };
  registerServerStop((why) => server.stop(why));
  try {
    const r = await client(app, { remoteAddress: "127.0.0.1" }).post("/v1/shutdown");
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ ok: true, exiting: true });
    expect(stopped, "the speech runtime's servers stop before the server goes").toEqual([true]);
    expect(server.stopped).toEqual([]);
    await new Promise((res) => setImmediate(res));
    expect(server.stopped.length).toBe(1); // uvicorn's should_exit
    // A stalled exit still ends: the deadline exits the process.
    expect(timers.length).toBe(1);
    expect(timers[0][0]).toBe(10.0);
    timers[0][1]();
    expect(exits).toEqual([0]);
  } finally {
    Object.assign(shutdownCfg, SYSTEM_CFG);
    registerServerStop(null);
  }
});

test("shutdown_without_a_server_handle_only_stops_engines", async () => {
  const app = await makeApp();
  const stopped = [];
  speechRuntime(stopped);
  const r = await client(app, { remoteAddress: "127.0.0.1" }).post("/v1/shutdown");
  expect(r.json()).toEqual({ ok: true, exiting: false });
  expect(stopped).toEqual([true]);
});

// ── The close works with "Require a token even on localhost" on (2026-09-30) ──

test("shutdown_needs_no_token_from_this_machine", async () => {
  const app = await makeApp();
  const stopped = [];
  speechRuntime(stopped);
  shutdownCfg.startTimer = () => {};
  try {
    const local = client(app, { remoteAddress: "127.0.0.1" });
    const r = await local.patch("/v1/settings", { json: { auth: { tokens: ["t0k"], require_for_loopback: true } } });
    expect(r.status, r.text).toBe(200);
    expect((await local.get("/v1/settings")).status).toBe(401); // the setting is really on

    expect((await local.post("/v1/shutdown")).status).toBe(200); // the shell's close, no token
    expect(stopped).toEqual([true]);
    const remote = client(app, { remoteAddress: "192.168.1.20" });
    expect((await remote.post("/v1/shutdown")).status).toBe(401);
  } finally {
    Object.assign(shutdownCfg, SYSTEM_CFG);
  }
});
