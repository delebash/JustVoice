// SPDX-License-Identifier: MIT
// Moving the speech runtime to a newer pinned release (decided 2026-10-03, TASKS "Our copy of
// audio.cpp"): an installed older build keeps working, the runtime row offers "Update to
// <tag>", and the update stops the old processes so the next load starts the pinned build
// (the port of tests/test_runtime_update.py; the parametrized update test loops over its
// cases).
//
// Not ported here (a later wave's modules — app.js / api/*): test.todo.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as binary from "@delebash/llm-runner/runner/binary";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as espeak from "../src/engines/audiocpp/espeak.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines } from "../src/engines/manager.js";
import { tmpPath } from "./helpers.js";

const TAG = release.cfg.TAG;
const PREVIOUS = release.cfg.PREVIOUS_TAGS;
afterEach(() => {
  release.cfg.TAG = TAG;
  release.cfg.PREVIOUS_TAGS = PREVIOUS;
  runtime.forgetInstalled();
});

/** A pinned release "v9-new", an older "v9-old" still installed; the kit's lookup finds
 * whichever tag has a folder. Returns the set of tags on disk. */
function tags() {
  const tmp = tmpPath();
  release.cfg.TAG = "v9-new";
  release.cfg.PREVIOUS_TAGS = ["v9-old"];
  const onDisk = new Set(["v9-old"]);
  vi.spyOn(binary, "installedRuntimeExe").mockImplementation((cacheRoot, folder, build) => {
    const exe = path.join(tmp, build, "audiocpp_server.exe");
    if (onDisk.has(build)) {
      mkdirSync(path.dirname(exe), { recursive: true });
      writeFileSync(exe, "x");
      return exe;
    }
    return null;
  });
  vi.spyOn(runtime, "selectedAsset").mockReturnValue({ gpu: "cuda12" });
  vi.spyOn(runtime, "configuredBackend").mockReturnValue("cuda");
  vi.spyOn(runtime, "_runtimeRoot").mockReturnValue(tmp);
  runtime.forgetInstalled();
  return onDisk;
}

test("an_older_pinned_build_keeps_working_until_updated", () => {
  const onDisk = tags();
  const exe = runtime.installedExe();
  expect(exe).not.toBeNull();
  expect(path.basename(path.dirname(exe))).toBe("v9-old");
  expect(runtime.installedTag()).toBe("v9-old");
  onDisk.add("v9-new"); // the update lands
  runtime.forgetInstalled();
  expect(path.basename(path.dirname(runtime.installedExe()))).toBe("v9-new");
  expect(runtime.installedTag()).toBe("v9-new");
});

test("nothing_installed_is_nothing", () => {
  tags().clear();
  expect(runtime.installedExe()).toBeNull();
  expect(runtime.installedTag()).toBeNull();
});

test.todo("the_runtime_row_offers_the_update — waits for api/speech_runtime_api.js");

test("an_update_stops_the_old_processes_and_a_fresh_install_does_not", async () => {
  // An update also deletes the build it replaced (decided 2026-10-03) — only that one: the
  // older release's other backend keeps working until it is updated.
  for (const [was, stops] of [
    ["v9-old", true],
    ["v9-new", false],
    [null, false],
  ]) {
    vi.restoreAllMocks();
    const tmp = tmpPath();
    const old = path.join(tmp, "v9-old", "cuda12");
    const other = path.join(tmp, "v9-old", "vulkan");
    for (const d of [old, other, path.join(tmp, "v9-new", "cuda12")]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, "audiocpp_server.exe"), "x");
    }
    vi.spyOn(runtime, "_runtimeRoot").mockReturnValue(tmp);
    release.cfg.TAG = "v9-new";
    vi.spyOn(runtime, "installedTag").mockReturnValue(was);
    vi.spyOn(runtime, "installedExe").mockReturnValue(path.join(tmp, was || "v9-new", "cuda12", "audiocpp_server.exe"));
    const bytesSeen = [];
    vi.spyOn(runtime, "install").mockImplementation(async ({ onProgress }) => {
      onProgress(5, 10);
      return "x";
    });
    vi.spyOn(espeak, "install").mockResolvedValue(["a", "b"]);
    const stopped = [];
    vi.spyOn(runtime, "shutdownServer").mockImplementation(async () => stopped.push("server"));
    vi.spyOn(manager, "getManager").mockReturnValue({
      loadedFor: (kind) => (kind === "tts" ? { manifest: { usesAudiocpp: true } } : null),
      unload: async (kind) => stopped.push(`unload ${kind}`),
    });
    await manager._installAudiocppRuntime({ onBytes: (done, total) => bytesSeen.push([done, total]) });
    expect(stopped, String(was)).toEqual(stops ? ["unload tts", "server"] : []);
    expect(bytesSeen).toEqual([[5, 10]]); // the job gets the download's bytes
    expect(existsSync(old)).toBe(!stops); // the replaced build goes on an update
    expect(existsSync(other) && existsSync(path.join(tmp, "v9-new", "cuda12"))).toBe(true);
  }
});

test("voxcpm2s_transcript_follows_the_pin", () => {
  // Our build 1 passes a VoxCPM2 clip's transcript on; upstream v0.9.0 ignored it.
  release.cfg.TAG = "v0.9.0";
  expect(release.pinnedHas("voxcpm2_transcript")).toBe(false);
  release.cfg.TAG = "v0.9.0-jv.1";
  expect(release.pinnedHas("voxcpm2_transcript")).toBe(true);
});

test("the_pin_is_our_build_and_the_older_ones_keep_working", () => {
  expect(release.cfg.TAG).toBe("v0.9.0-jv.4");
  expect(release.cfg.PREVIOUS_TAGS).toEqual(["v0.9.0-jv.1", "v0.9.0"]);
  expect(
    release.binaries().every((b) => b.assetUrl.startsWith("https://github.com/delebash/audio.cpp/releases/download/v0.9.0-jv.4/")),
  ).toBe(true);
  // Every feature the app knows names a build in the order; jv.2 and jv.3 were never published.
  for (const v of Object.values(release.FEATURES)) expect(release.BUILDS_IN_ORDER).toContain(v);
  expect(release.BUILDS_IN_ORDER).not.toContain("v0.9.0-jv.2");
  expect(release.BUILDS_IN_ORDER).not.toContain("v0.9.0-jv.3");
});

// ── A clone's transcript is only what was typed (decided 2026-10-03) ─────

const qwenBaseRow = () => discoverEngines().get("qwen3").module.VARIANTS.find((r) => r.id === "qwen3-base-1.7b-q8");

test("qwen3_base_clones_with_its_transcript_or_the_speaker_vector", () => {
  const clip = { text: "Hi.", audio_prompt_path: "C:/v/ref.wav" };
  let req = toSpeechRequest(qwenBaseRow(), { ...clip, ref_text: "What the clip says." });
  expect(req.reference_text).toBe("What the clip says.");
  expect("x_vector_only_mode" in (req.options || {})).toBe(false);
  req = toSpeechRequest(qwenBaseRow(), { ...clip, ref_text: "ignored", xvector_only: true });
  expect(req.options.x_vector_only_mode).toBe(true);
  expect("reference_text" in req).toBe(false);
});

test("qwen3_base_without_either_is_refused_by_name", () => {
  expect(() => toSpeechRequest(qwenBaseRow(), { text: "Hi.", audio_prompt_path: "C:/v/ref.wav" })).toThrow(
    "Qwen3 Base needs what the clip says — type the transcript, or tick Skip the words.",
  );
});

test.todo("a_cloned_audition_needs_no_transcript_and_sends_none — waits for app.js + api/voice_preview_api.js");
test.todo("a_saved_voice_keeps_skip_the_words — waits for app.js + api/voices_api.js + render_core.js");
