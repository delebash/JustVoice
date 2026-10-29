// SPDX-License-Identifier: MIT
// `npm run dev` runs our audio.cpp checkout's own build (docs/dev/TASKS.md, "`npm run dev`
// always runs the latest audio.cpp"): the server reads the build from JUSTVOICE_AUDIOCPP_BUILD —
// its server, its backend from the build's own CMake cache, its version for the runtime row — and
// offers every feature for it. Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md §3.3,
// §4 step 1) the kit's audio.cpp runtime runs that build in place of an installed one
// (`runtimeExeOverrides`, kit_runtime_wiring.test.js) and owns its install, its eSpeak NG, its
// runtime row and the server processes; what stays ours is reading the build (dev_build.js
// `current()`) and every feature on for it (kit_settings.js `shippedHas`, `runtimeHas`), and the
// catalog built under it (the port of tests/test_audiocpp_dev_build.py).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stores } from "@delebash/core/llm";
import { runtime as dataRuntime } from "@delebash/core/platform/data_paths";
import { pinKey, runtimeOf } from "@delebash/core/runner/runtimes";
import { afterEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import * as devBuild from "../src/engines/audiocpp/dev_build.js";
import { ownEngine } from "../src/engines/audiocpp/generated.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import { tmpPath } from "./helpers.js";

// Chatterbox and Kokoro built again under the build a test sets (Python reloaded their manifests;
// since the adoption plan's slice 4 they are built from audio.cpp's files and our notes).
const chatterbox = { build: () => ownEngine("chatterbox") };
const kokoro = { build: () => ownEngine("kokoro") };

/** A stand-in for ../audio.cpp/build/jv-dev: the server exe, the CMake cache, the info. */
function makeBuild(root, { cuda = true, dirty = false } = {}) {
  const binDir = path.join(root, "audio.cpp", "build", "jv-dev", "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, devBuild.SERVER_EXE), "x");
  writeFileSync(path.join(path.dirname(binDir), "CMakeCache.txt"), `ENGINE_ENABLE_CUDA:BOOL=${cuda ? "ON" : "OFF"}\nENGINE_ENABLE_VULKAN:BOOL=OFF\n`);
  writeFileSync(path.join(binDir, "jv-dev-build.json"), JSON.stringify({ commit: "6a2bb4c5", dirty, source: "..\\audio.cpp" }));
  return binDir;
}

const FROZEN = dataRuntime.frozen;
afterEach(() => {
  dataRuntime.frozen = FROZEN;
  devBuild.current.cacheClear();
  endState();
});

/** The server pointed at a development build. */
function dev() {
  const binDir = makeBuild(tmpPath());
  vi.stubEnv(devBuild.ENV, binDir);
  devBuild.current.cacheClear();
  return binDir;
}

test("without_the_variable_there_is_no_dev_build", () => {
  vi.stubEnv(devBuild.ENV, "");
  devBuild.current.cacheClear();
  expect(devBuild.current()).toBeNull();
});

test("a_packaged_app_ignores_it", () => {
  dev();
  dataRuntime.frozen = true;
  devBuild.current.cacheClear();
  expect(devBuild.current()).toBeNull();
});

test("a_folder_without_the_server_runs_the_pinned_release", () => {
  vi.stubEnv(devBuild.ENV, tmpPath());
  devBuild.current.cacheClear();
  expect(devBuild.current()).toBeNull();
});

test("the_build_is_read_from_its_own_folder", () => {
  const binDir = dev();
  const b = devBuild.current();
  expect([b.exe, b.backend, b.commit, b.source]).toEqual([path.join(binDir, devBuild.SERVER_EXE), "cuda", "6a2bb4c5", "..\\audio.cpp"]);
  expect(b.version).toBe("dev · 6a2bb4c5");
});

test("uncommitted_edits_show_in_the_version", () => {
  vi.stubEnv(devBuild.ENV, makeBuild(tmpPath(), { cuda: false, dirty: true }));
  devBuild.current.cacheClear();
  const b = devBuild.current();
  expect([b.version, b.backend]).toEqual(["dev · 6a2bb4c5 + local changes", "cpu"]);
});

test("the_dev_build_has_every_feature", () => {
  // An older build pinned on this computer lacks them …
  useState();
  stores.getRunnerConfigStore().setSetting(pinKey("audiocpp"), "v0.9.0");
  expect(kitSettings.runtimeHas("voice_pack")).toBe(false);
  // … the dev build, the fork's latest, has every one the kit knows — both what the app offers and
  // what the build here answers for; a feature the kit doesn't know stays off.
  dev();
  for (const f of Object.keys(runtimeOf("audiocpp").defaults.features)) {
    expect(kitSettings.runtimeHas(f), f).toBe(true);
    expect(kitSettings.shippedHas(f), f).toBe(true);
  }
  expect(kitSettings.runtimeHas("no_such_feature")).toBe(false);
  expect(kitSettings.shippedHas("no_such_feature")).toBe(false);
});

test("the_catalogs_offer_what_the_dev_build_reads", () => {
  // Python reloaded the manifests under the dev build; here their build-dependent half is built
  // again.
  dev();
  const cb = chatterbox.build();
  for (const l of ["he", "ru", "zh", "ja"]) expect(cb.VARIANTS[0].languages).toContain(l);
  expect(kokoro.build().STATIC_VOICES.length).toBe(54);
});

// ── the wrapper's check before it builds (decided D5) ─────────────────────

/** A process table: the app's server, the programs it runs from the dev build, and an orphan. */
function table(bin) {
  return [
    { pid: 100, ppid: 1, exe: "C:\node\electron.exe", created: 1000 },
    { pid: 101, ppid: 100, exe: path.join(bin, devBuild.SERVER_EXE), created: 1010 },
    { pid: 102, ppid: 100, exe: path.join(bin, "audiocpp_dsp.exe"), created: 1011 },
    { pid: 200, ppid: 4242, exe: path.join(bin, devBuild.SERVER_EXE), created: 900 }, // its JustVoice is gone
    { pid: 300, ppid: 100, exe: "C:\elsewhere\audiocpp_server.exe", created: 1020 },
  ];
}

test("the_wrapper_stops_what_a_closed_justvoice_left_and_refuses_while_one_runs_its_build", async () => {
  const { guardRunningBuild } = await import("../../scripts/audiocpp-dev.js");
  const bin = path.join(tmpPath("jv-dev-guard-"), "bin");
  const killed = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  // the app still runs the build's server and its DSP program: nothing is stopped, the build waits
  expect(() => guardRunningBuild({ table: table(bin), kill: (pid) => killed.push(pid), bin })).toThrow("Close the running JustVoice first.");
  expect(killed).toEqual([]);
  // the app closed: only the orphans of this build go — never another folder's program
  const closed = table(bin).filter((p) => p.ppid !== 100 || p.pid === 300);
  expect(guardRunningBuild({ table: closed, kill: (pid) => killed.push(pid), bin })).toEqual([200]);
  expect(killed).toEqual([200]);
  // a pid its JustVoice's went to after it started is a closed JustVoice too
  const recycled = [{ pid: 100, ppid: 1, exe: "C:\other.exe", created: 5000 }, { pid: 101, ppid: 100, exe: path.join(bin, devBuild.SERVER_EXE), created: 1010 }];
  expect(guardRunningBuild({ table: recycled, kill: () => {}, bin })).toEqual([101]);
  // nothing of the build running: nothing to do
  expect(guardRunningBuild({ table: [table(bin)[0]], kill: () => {}, bin })).toEqual([]);
});
