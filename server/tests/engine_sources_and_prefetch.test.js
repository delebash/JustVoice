// SPDX-License-Identifier: MIT
// S0 + S1 from docs/plans/2026-06-14-engines-download-contract.md. Since round E (docs/plans/
// 2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime downloads every model file — pinned
// by SHA-256 into its models cache, with its progress, cancel and resume — and tests that; the
// per-version download mirror (/v1/engine-sources), the prefetch worker, the job route and the
// speech cache's clear went with JustVoice's own runtime (plan §5 item 12). What stays ours is the
// models list's answer for the desktop "Open folder" verb: a version is on disk when the kit's cache
// holds every file, and the folder is resolved by the server from the kit's files (the port of
// tests/test_engine_sources_and_prefetch.py).
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";

const VARIANT = "chatterbox-multilingual-v2-q8";

afterEach(async () => {
  endSpeech();
  await closeApps();
});

// ── The models list serves local_dir for "Open folder" ───────────────

test("models_list_serves_the_kits_local_dir", async () => {
  // The desktop "Open folder" verb needs the resolved on-disk folder; the SERVER resolves it so
  // the cache-layout knowledge stays in one place — the folder of the version's main file.
  const { c } = await appClient();
  fakeSpeechRuntime({ onDisk: [VARIANT], files: { [VARIANT]: { model: "C:/cache/hf/chatterbox/Chatterbox-GGUF/chatterbox-q8_0.gguf" } } });
  const row = (await c.get("/v1/engines/chatterbox/models")).json().variants.find((v) => v.id === VARIANT);
  expect(row.on_disk).toBe(true);
  expect(row.local_dir.replaceAll("\\", "/")).toBe("C:/cache/hf/chatterbox/Chatterbox-GGUF");
});

test("a_model_not_in_the_kits_cache_is_not_on_disk", async () => {
  // Only the kit's models cache counts — never another cache, never a folder.
  const { c } = await appClient();
  fakeSpeechRuntime();
  const rows = (await c.get("/v1/engines/chatterbox/models")).json().variants;
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((v) => v.on_disk === false && v.local_dir === null)).toBe(true);
});
