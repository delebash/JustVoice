// SPDX-License-Identifier: MIT
// The DSP program starts through the kit's (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md
// §4 step 7 — audio/dsp_client.js): its port from the kit's findFreePort, its log rotated by the
// kit's rotateLog, its environment the kit's childEnv, the kit's spawnChild — never the speech
// runtime's own helpers. Nothing is started: the kit's process seams answer here.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { tmpPath } from "./helpers.js";

const kit = vi.hoisted(() => ({ spawned: [], rotated: [], ports: 0, popened: [] }));

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
  return { ...real, fetch: async () => new Response(Buffer.from("RIFF"), { status: 200 }) };
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
