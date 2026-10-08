// SPDX-License-Identifier: MIT
// `npm run dev` runs our audio.cpp checkout's own build (docs/dev/TASKS.md, "`npm run dev`
// always runs the latest audio.cpp"): the server reads the build from
// JUSTVOICE_AUDIOCPP_BUILD, runs it instead of the pinned release, offers every feature, shows
// it on the runtime row, and installs only eSpeak NG for it (the port of
// tests/test_audiocpp_dev_build.py).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runtime as dataRuntime } from "@delebash/llm-runner/platform/data_paths";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as speechRuntimeApi from "../src/api/speech_runtime_api.js";
import * as devBuild from "../src/engines/audiocpp/dev_build.js";
import * as espeak from "../src/engines/audiocpp/espeak.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import * as chatterbox from "../src/engines/chatterbox/manifest.js";
import * as kokoro from "../src/engines/kokoro/manifest.js";
import * as leftovers from "../src/engines/leftovers.js";
import * as manager from "../src/engines/manager.js";
import { tmpPath } from "./helpers.js";

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
  runtime.forgetInstalled();
});

/** The server pointed at a development build, with eSpeak NG installed. */
function dev() {
  const tmp = tmpPath();
  const binDir = makeBuild(tmp);
  vi.stubEnv(devBuild.ENV, binDir);
  vi.spyOn(runtime, "_runtimeRoot").mockReturnValue(path.join(tmp, "rt"));
  vi.spyOn(espeak, "paths").mockReturnValue(["lib.dll", "data"]);
  devBuild.current.cacheClear();
  runtime.forgetInstalled();
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

test("the_runtime_is_the_dev_build_with_every_feature", () => {
  const binDir = dev();
  const exe = runtime.installedExe();
  expect(exe).toBe(path.join(binDir, devBuild.SERVER_EXE));
  expect(runtime.installedTag()).toBe("dev");
  expect(runtime.backendOf(exe)).toBe("cuda");
  for (const f of Object.keys(release.FEATURES)) {
    expect(runtime.hasFeature(f)).toBe(true);
    expect(release.pinnedHas(f)).toBe(true);
  }
  expect(runtime.hasFeature("no_such_feature")).toBe(false);
  expect(release.pinnedHas("no_such_feature")).toBe(false);
});

test("without_espeak_it_waits_for_install", () => {
  dev();
  vi.spyOn(espeak, "paths").mockReturnValue(null);
  runtime.forgetInstalled();
  expect(runtime.installedExe()).toBeNull();
});

test("the_catalogs_offer_what_the_dev_build_reads", () => {
  // Python reloaded the manifests under the dev build; here their pin-dependent half is built
  // again.
  dev();
  const cb = chatterbox.build();
  for (const l of ["he", "ru", "zh", "ja"]) expect(cb.VARIANTS[0].languages).toContain(l);
  expect(kokoro.build().STATIC_VOICES.length).toBe(54);
});

test("the_runtime_row_says_it_is_the_dev_build", () => {
  dev();
  const srv = { _run: null, pid: null, isRunning: () => false };
  vi.spyOn(runtime, "servers").mockReturnValue([srv]);
  vi.spyOn(runtime, "availableBackends").mockReturnValue(["cuda", "cpu"]);
  vi.spyOn(runtime, "_hardware").mockReturnValue({ gpus: [] });
  vi.spyOn(runtime, "cpuThreads").mockReturnValue(8);
  vi.spyOn(runtime, "physicalCores").mockReturnValue(8);
  vi.spyOn(runtime, "_settings").mockReturnValue({ backend: "vulkan", gpu: 0, cpu_threads: 0, cpu_min_realtime: 2.0 });
  const info = speechRuntimeApi._info();
  expect([info.installed, info.version, info.update_to, info.backend, info.build, info.dev_source]).toEqual([
    true,
    "dev · 6a2bb4c5",
    null,
    "cuda",
    null,
    "..\\audio.cpp",
  ]);
  expect(info.japanese_dictionary).not.toBeNull(); // the dev build reads Japanese
});

test("install_fetches_only_espeak", async () => {
  dev();
  const calls = [];
  vi.spyOn(runtime, "install").mockImplementation(async () => calls.push("binary"));
  vi.spyOn(espeak, "install").mockImplementation(async () => calls.push("espeak"));
  vi.spyOn(manager, "_removeReplacedBuild").mockImplementation(async () => calls.push("remove"));
  await manager._installAudiocppRuntime();
  expect(calls).toEqual(["espeak"]);
});

test("the_leftover_sweep_covers_the_dev_build", () => {
  const binDir = dev();
  const roots = leftovers._audiocppRoots();
  expect(leftovers._engineIdOf([path.join(binDir, devBuild.SERVER_EXE), "--config", "x"], roots)).toBe("audiocpp");
  expect(leftovers._engineIdOf(["C:\\elsewhere\\audiocpp_server.exe"], roots)).toBeNull();
});

test("the_wrapper_is_told_when_the_app_still_runs_it", async () => {
  // Before it builds, `npm run dev` stops servers whose JustVoice is gone and refuses (exit 3)
  // while one still serves a running app — it holds the exe (decided D5).
  const binDir = dev();
  const stopped = [];
  vi.spyOn(leftovers, "stopLeftoverEngines").mockImplementation(async (reason) => {
    stopped.push(reason);
    return [];
  });
  const procs = [{ pid: 11, exe: "C:\\other\\x.exe" }];
  vi.spyOn(leftovers, "processTable").mockImplementation(async () => procs);
  expect(await devBuild._stopLeftovers()).toBe(0);
  expect(stopped).toEqual(["npm run dev"]);
  procs.push({ pid: 12, exe: path.join(binDir, devBuild.SERVER_EXE) });
  expect(await devBuild._stopLeftovers()).toBe(3);
});
