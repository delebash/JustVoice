// SPDX-License-Identifier: MIT
// The app turns on the kit's audio.cpp runtime (round E, docs/plans/2026-10-29-round-e-onto-the-
// kit.md §4 step 1 — app.js's installLlm): its routes answer with our models, its service runs our
// hooks, and under `npm run dev` it runs our audio.cpp checkout's build in place of an installed one.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { getRuntimeService } from "@delebash/core/runner/runtime_service";
import * as devBuild from "../src/engines/audiocpp/dev_build.js";
import { runtimeModelRows } from "../src/engines/audiocpp/kit_models.js";
import { appClient, closeApps } from "./app_helpers.js";
import { wav } from "./engines_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(async () => {
  delete process.env[devBuild.ENV];
  devBuild.current.cacheClear();
  await closeApps();
});

test("the kit's audio.cpp runtime lists our models, runs our hooks and our development build", async () => {
  const { c } = await appClient();
  const r = await c.get("/v1/ai/runtimes/audiocpp/models");
  expect(r.status).toBe(200);
  expect(r.json().models.map((m) => m.id)).toEqual(runtimeModelRows().map((m) => m.id));
  expect(r.json().models.find((m) => m.id === "qwen3-asr-1.7b-q8")).toMatchObject({ kind: "stt", onDisk: false });

  const svc = getRuntimeService("audiocpp");
  // the transcription hook shapes a request (G1)
  const clip = path.join(tmpPath("jv-kit-wire-"), "clip.wav");
  writeFileSync(clip, wav(1, 16000));
  expect(await svc.transcriptionRequest("qwen3-asr-1.7b-q8", { audio_path: clip, language: "en" })).toEqual({
    body: { model: "qwen3-asr-1.7b-q8", audio: clip.replaceAll("\\", "/"), language: "English" },
    timeout: 900,
  });

  // npm run dev's build stands in for an installed one: its server, its backend, its version
  expect(svc.installedExe()).toBeNull();
  const binDir = path.join(tmpPath("jv-kit-dev-"), "build", "jv-dev", "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, devBuild.SERVER_EXE), "");
  writeFileSync(path.join(path.dirname(binDir), "CMakeCache.txt"), "ENGINE_ENABLE_CUDA:BOOL=ON\n");
  writeFileSync(path.join(binDir, "jv-dev-build.json"), JSON.stringify({ commit: "1de98891" }));
  process.env[devBuild.ENV] = binDir;
  devBuild.current.cacheClear();
  expect(svc.installedExe()).toBe(path.join(binDir, devBuild.SERVER_EXE));
  expect(svc._dev()).toEqual({ exe: path.join(binDir, devBuild.SERVER_EXE), backend: "cuda", version: "dev · 1de98891" });
});
