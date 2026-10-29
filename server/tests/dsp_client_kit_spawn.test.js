// SPDX-License-Identifier: MIT
// The DSP program starts through the kit's (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md
// §4 step 7 — audio/dsp_client.js): its port from the kit's findFreePort, its log rotated by the
// kit's rotateLog, its environment the kit's childEnv, the kit's spawnChild — never the speech
// runtime's own helpers. Nothing is started: the kit's process seams answer here.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { stores } from "@delebash/core/llm";
import { endState, useState } from "./engines_helpers.js";
import { tmpPath } from "./helpers.js";

const kit = vi.hoisted(() => ({ spawned: [], rotated: [], ports: 0, popened: [], fetches: [], health: 200 }));

vi.mock("@delebash/core/platform/procs", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    popen: (argv, opts) => {
      kit.popened.push({ argv, opts });
      return { pid: 4321, kill: () => {} };
    },
  };
});

vi.mock("@delebash/core/runner/process", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    findFreePort: async () => {
      kit.ports += 1;
      return 41234;
    },
    spawnChild: async (popen, argv, logPath) => {
      kit.spawned.push({ argv, logPath });
      return [popen(argv, { stdio: ["ignore", "pipe", "pipe"] }), null];
    },
    pollProc: () => null,
    closeJob: () => {},
    waitExit: async () => 0,
  };
});
vi.mock("@delebash/core/runner/audiocpp", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    rotateLog: (p) => kit.rotated.push(p),
    childEnv: (extra = {}) => ({ KIT_CHILD_ENV: "1", ...extra }),
  };
});
vi.mock("@delebash/core/platform/http", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    fetch: async (url, init = {}) => {
      kit.fetches.push({ url, timeoutMs: init.timeoutMs });
      return new Response(Buffer.from("RIFF"), { status: String(url).endsWith("/health") ? kit.health : 200 });
    },
  };
});

const dspClient = await import("../src/audio/dsp_client.js");

afterEach(async () => {
  await dspClient.stop();
  delete process.env[dspClient.ENV_EXE];
});

test("the DSP program starts on the kit's free port, log rotation and environment", async () => {
  const exe = path.join(tmpPath("jv-dsp-kit-"), dspClient.EXE_NAME);
  writeFileSync(exe, "");
  process.env[dspClient.ENV_EXE] = exe;
  await dspClient._post("shape", {}, []);
  expect(kit.ports).toBe(1);
  expect(kit.spawned).toHaveLength(1);
  expect(kit.spawned[0].argv).toEqual([exe, "--port", "41234"]);
  expect(kit.rotated).toEqual([kit.spawned[0].logPath]);
  expect(path.basename(kit.spawned[0].logPath)).toBe("audiocpp-dsp.log");
  // in its own folder, with the kit's environment for a runtime's child
  expect(kit.popened[0].opts).toMatchObject({ cwd: path.dirname(exe), env: { KIT_CHILD_ENV: "1" } });
});

test("its time limits are the kit's audio.cpp runtime's: one request's, and its start's", async () => {
  useState();
  try {
    const exe = path.join(tmpPath("jv-dsp-kit-"), dspClient.EXE_NAME);
    writeFileSync(exe, "");
    process.env[dspClient.ENV_EXE] = exe;
    stores.getRunnerConfigStore().setSetting("request_timeout_s:audiocpp", "7");
    kit.fetches.length = 0;
    await dspClient._post("shape", {}, []);
    expect(kit.fetches.find((f) => f.url.includes("/v1/dsp/shape")).timeoutMs).toBe(7000);
    // a program that never answers is given up on at the start limit
    await dspClient.stop();
    stores.getRunnerConfigStore().setSetting("start_timeout_s:audiocpp", "1");
    kit.health = 503;
    await expect(dspClient._post("shape", {}, [])).rejects.toThrow(/did not answer within 1 s/);
  } finally {
    kit.health = 200;
    endState();
  }
});
