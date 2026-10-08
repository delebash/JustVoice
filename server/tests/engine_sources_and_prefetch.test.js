// SPDX-License-Identifier: MIT
// S0 + S1 from docs/plans/2026-06-14-engines-download-contract.md (the port of
// tests/test_engine_sources_and_prefetch.py): the sources endpoints + the resolveSource helper
// the prefetch worker reads, and spawnPrefetch — a variant's pinned file(s) into the speech
// cache, with progress + cancel. All network is faked (the kit's resolver and downloader); the
// tests run against the real plugin manager so the variant lookup uses the server's own path.
//
// Python's "no huggingface_hub" half of prefetch_lands_plain_files has no JavaScript
// counterpart (there is no hub library to block); the no-hub-layout half runs.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sleep } from "@delebash/llm-runner/platform/asyncutil";
import * as dl from "@delebash/llm-runner/runner/download";
import { DownloadCancelled } from "@delebash/llm-runner/runner/download";
import * as km from "@delebash/llm-runner/runner/models";
import { afterEach, expect, test, vi } from "vitest";
import { resolveSource } from "../src/api/engine_sources_api.js";
import { getState } from "../src/app_state.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as cb from "../src/engines/chatterbox/manifest.js";
import * as manager from "../src/engines/manager.js";
import * as installer from "../src/installer.js";
import { spawnPrefetch } from "../src/installer.js";
import { speechCacheRoot } from "../src/paths.js";
import * as speechCache from "../src/speech_cache.js";
import { appClient, closeApps } from "./app_helpers.js";
import { endState, useState } from "./engines_helpers.js";

const VARIANT = "chatterbox-multilingual-v2-q8";
const PINNED = "Chatterbox-GGUF/chatterbox-q8_0.gguf";

afterEach(async () => {
  await closeApps();
  endState();
});

/** Files + the speech cache's files.json record, as a finished fetch leaves them. */
function putOnDisk(vdir, name, size) {
  mkdirSync(path.dirname(path.join(vdir, name)), { recursive: true });
  writeFileSync(path.join(vdir, name), Buffer.alloc(size));
  writeFileSync(path.join(vdir, speechCache.MANIFEST_NAME), JSON.stringify({ sources: [], files: [{ path: name, size, oid: "" }] }), "utf8");
}

// ── S0 — sources endpoint ────────────────────────────────────────────

test("sources_list_uses_catalog_variant_ids_and_manifest_provenance", async () => {
  const { c } = await appClient();
  const r = await c.get("/v1/engines/chatterbox/sources");
  expect(r.status).toBe(200);
  const body = r.json();
  expect(body.engine_id).toBe("chatterbox");
  expect(body.variants.length, "chatterbox should expose variants").toBeGreaterThan(0);
  // audio.cpp's own repo, or our Turbo / Nano conversions (offered since v0.9.0-jv.4).
  const pinned = { [release.MODEL_REPO]: release.MODEL_REVISION, [cb.TURBO_REPO]: cb.TURBO_REVISION, [cb.NANO_REPO]: cb.NANO_REVISION };
  for (const v of body.variants) {
    expect(v.variant_id).not.toContain("/");
    expect(v.provenance).toBe("manifest");
    expect(pinned[v.hf_repo], v.variant_id).toBe(v.hf_revision);
  }
});

test("sources_put_persists_and_flips_provenance", async () => {
  const { c } = await appClient();
  const r = await c.put(`/v1/engines/chatterbox/sources/${VARIANT}`, { json: { hf_repo: "my-fork/audio-gguf", hf_revision: "v1.2" } });
  expect(r.status).toBe(200);
  expect(r.json().provenance).toBe("override");
  expect(r.json().hf_repo).toBe("my-fork/audio-gguf");

  const after = (await c.get("/v1/engines/chatterbox/sources")).json();
  const row = after.variants.find((v) => v.variant_id === VARIANT);
  expect(row.provenance).toBe("override");
  expect(row.hf_repo).toBe("my-fork/audio-gguf");

  const settings = (await c.get("/v1/settings")).json();
  expect(settings.engines.engine_overrides.chatterbox.sources[VARIANT].hf_repo).toBe("my-fork/audio-gguf");
});

test("sources_delete_reverts_and_gcs_empty_engine", async () => {
  const { c } = await appClient();
  await c.put(`/v1/engines/chatterbox/sources/${VARIANT}`, { json: { hf_repo: "x/y" } });
  const r = await c.delete(`/v1/engines/chatterbox/sources/${VARIANT}`);
  expect(r.status).toBe(200);
  expect(r.json().provenance).toBe("manifest");
  // The empty engine entry is GC'd from settings so the tree doesn't accumulate dead keys.
  expect((await c.get("/v1/settings")).json().engines.engine_overrides).not.toHaveProperty("chatterbox");
});

test("sources_negatives", async () => {
  const { c } = await appClient();
  expect((await c.get("/v1/engines/nope/sources")).status).toBe(404);
  expect((await c.put("/v1/engines/chatterbox/sources/not-a-real-variant", { json: { hf_repo: "x/y" } })).status).toBe(404);
  expect((await c.put(`/v1/engines/chatterbox/sources/${VARIANT}`, { json: {} })).status).toBe(400);
  // A URL override went with the tarball engines; hf_repo is required.
  expect((await c.put(`/v1/engines/chatterbox/sources/${VARIANT}`, { json: { url: "http://x" } })).status).toBe(400);
});

test("an_override_swaps_the_repo_and_keeps_the_pinned_files", async () => {
  // The resolver the prefetch worker reads is the same one GET uses. An override points at a
  // mirror holding the SAME files: the runtime's config names them.
  const { c } = await appClient();
  let [src, prov] = resolveSource("chatterbox", VARIANT);
  expect(prov).toBe("manifest");
  expect(src.hf_repo).toBe(release.MODEL_REPO);
  expect(src.files).toEqual([PINNED]);

  await c.put(`/v1/engines/chatterbox/sources/${VARIANT}`, { json: { hf_repo: "operator/mirror", hf_revision: "abc" } });
  [src, prov] = resolveSource("chatterbox", VARIANT);
  expect(prov).toBe("override");
  expect(src.hf_repo).toBe("operator/mirror");
  expect(src.files).toEqual([PINNED]);
  expect(src.sources.map((s) => [s.hf_repo, s.revision, s.files])).toEqual([["operator/mirror", "abc", [PINNED]]]);
});

// ── S1 — spawnPrefetch worker ──────────────────────────────────────

/** Spin until the worker reaches the target phase. */
async function waitForJob(state, jobId, phase, timeout = 5.0) {
  const end = Date.now() + timeout * 1000;
  let row = null;
  while (Date.now() < end) {
    row = state.jobGet(jobId);
    if (row && row.phase === phase) return row;
    await sleep(20);
  }
  throw new Error(`job '${jobId}' never reached phase '${phase}': last=${JSON.stringify(row)}`);
}

test("prefetch_unknown_engine_raises", async () => {
  const st = useState();
  await expect(spawnPrefetch(st, "no-such-engine", "vX")).rejects.toThrow(/no managed engine/);
});

/** The KIT resolver + downloader are the fetch path — fake both. */
function fakeHub(size, stream = null) {
  vi.spyOn(km, "selectRepoFiles").mockImplementation(async (_repo, { files = null } = {}) => {
    expect(files, "the pinned file list must reach the resolver").toEqual([PINNED]);
    return ["commit0000sha", [{ type: "file", path: PINNED, oid: "gitoid", size, lfs: { oid: "lfssha256", size } }]];
  });
  vi.spyOn(dl, "streamDownload").mockImplementation(
    stream ??
      (async (url, dest, { onProgress } = {}) => {
        expect(url).toContain("/resolve/commit0000sha/"); // sha-pinned, never symbolic
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, Buffer.alloc(size, "x"));
        if (onProgress) onProgress(size, size);
      }),
  );
  vi.spyOn(speechCache, "_downloadKwargs").mockReturnValue({ segments: 1, retries: 0 });
}

/** Every path under `root` (recursive) whose last part is `name`. */
const findNamed = (root, name) => readdirSync(root, { recursive: true }).filter((p) => path.basename(String(p)) === name);

test("prefetch_lands_plain_files_no_hub_dep_no_hub_layout", async () => {
  // Phase ② (plan doc §12): fetches land as PLAIN files + files.json in the speech cache — the
  // hub-cache layout (refs/blobs/snapshots + symlink-or-copy) must NOT be written at all.
  const { dir } = await appClient();
  fakeHub(1024);
  const state = getState();
  const jobId = await installer.spawnPrefetch(state, "chatterbox", VARIANT);
  const row = await waitForJob(state, jobId, "completed");
  expect([null, ""]).toContain(row.error ?? null);
  expect(row.bytes_total).toBe(1024); // the resolved real size

  const vdir = speechCache.variantDir(state.dataDir, "chatterbox", VARIANT);
  expect(statSync(path.join(vdir, PINNED)).size).toBe(1024);
  const man = speechCache.readManifest(vdir);
  expect(man.sources[0].commit_sha).toBe("commit0000sha");
  expect(new Set(man.files.map((f) => f.oid))).toEqual(new Set(["lfssha256"]));
  expect(speechCache.variantOnDisk(state.dataDir, "chatterbox", VARIANT)).toBe(true);
  expect(findNamed(dir, "blobs")).toEqual([]);
  expect(findNamed(dir, "snapshots")).toEqual([]);
});

/** A download that writes a partial, then waits for its cancel. */
function slowStream(started) {
  return async (_url, dest, { cancelCheck } = {}) => {
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(path.join(path.dirname(dest), `${path.basename(dest)}.part`), Buffer.alloc(512, "y"));
    started.push(true);
    for (let i = 0; i < 200; i++) {
      if (cancelCheck?.()) throw new DownloadCancelled();
      await sleep(20);
    }
  };
}

async function untilStarted(started) {
  for (let i = 0; i < 100 && !started.length; i++) await sleep(20);
}

test("prefetch_cancel_fails_the_job_and_keeps_partials_for_resume", async () => {
  // A mid-stream cancel marks the job failed=cancelled. The kit downloader's chunked partials
  // are KEPT — the next fetch resumes past them — and the variant does not count as on disk.
  await appClient();
  const started = [];
  fakeHub(4096, slowStream(started));
  const state = getState();
  const jobId = await installer.spawnPrefetch(state, "chatterbox", VARIANT);
  await untilStarted(started);
  installer.cancel(jobId);

  const row = await waitForJob(state, jobId, "failed");
  expect((row.error || "").toLowerCase()).toContain("cancel");
  expect(speechCache.variantOnDisk(state.dataDir, "chatterbox", VARIANT)).toBe(false);
  const vdir = speechCache.variantDir(state.dataDir, "chatterbox", VARIANT);
  expect(readdirSync(vdir, { recursive: true }).filter((p) => String(p).endsWith(".part")).length, "partials are kept for the resume").toBeGreaterThan(0);
});

test("prefetch_cancel_via_http_endpoint", async () => {
  // End-to-end: DELETE /v1/jobs/{id} signals the cancel cooperatively — the wire path the
  // renderer's Cancel button hits.
  const { c } = await appClient();
  const started = [];
  fakeHub(4096, slowStream(started));
  const state = getState();
  const jobId = await installer.spawnPrefetch(state, "chatterbox", VARIANT);
  await untilStarted(started);

  const resp = await c.delete(`/v1/jobs/${jobId}`);
  expect(resp.status).toBe(202);
  expect(resp.json()).toEqual({ cancelled: jobId });
  const row = await waitForJob(state, jobId, "failed", 5.0);
  expect((row.error || "").toLowerCase()).toContain("cancel");
});

// ── The models list serves local_dir for "Open folder" ───────────────

test("models_list_serves_speech_cache_local_dir", async () => {
  // The desktop "Open folder" verb needs the resolved on-disk folder; the SERVER resolves it so
  // the cache-layout knowledge stays in one place.
  const { c } = await appClient();
  const vdir = speechCache.variantDir(getState().dataDir, "chatterbox", VARIANT);
  putOnDisk(vdir, PINNED, 16);
  const row = (await c.get("/v1/engines/chatterbox/models")).json().variants.find((v) => v.id === VARIANT);
  expect(row.on_disk).toBe(true);
  expect(row.local_dir).toBe(String(vdir));
});

test("a_model_not_in_the_speech_cache_is_not_on_disk", async () => {
  // Only the speech cache counts — never a Hugging Face cache.
  const { c } = await appClient();
  const rows = (await c.get("/v1/engines/chatterbox/models")).json().variants;
  expect(rows.every((v) => v.on_disk === false && v.local_dir === null)).toBe(true);
});

// ── The whole-store speech-cache clear verb ──────────────────────────

test("speech_cache_clear_deletes_all_and_flips_on_disk", async () => {
  const { c } = await appClient();
  const st = getState();
  const vdir = speechCache.variantDir(st.dataDir, "chatterbox", VARIANT);
  putOnDisk(vdir, PINNED, 64);
  const r = (await c.post("/v1/engines/speech-cache/clear")).json();
  expect(r.ok).toBe(true);
  expect(r.bytes).toBeGreaterThan(0);
  expect(existsSync(speechCacheRoot(st.dataDir))).toBe(false);
  const row = (await c.get("/v1/engines/chatterbox/models")).json().variants.find((v) => v.id === VARIANT);
  expect(row.on_disk).toBe(false);
  expect(row.local_dir).toBeNull();
});

test("speech_cache_clear_refuses_while_an_engine_is_loaded", async () => {
  // One grammar with the kit's models-cache/clear: a resident model's file is open in the
  // runtime — refuse honestly, never half-delete.
  const { c } = await appClient();
  vi.spyOn(manager.getManager(), "status").mockReturnValue("loaded");
  const r = (await c.post("/v1/engines/speech-cache/clear")).json();
  expect(r).toEqual({ ok: false, detail: "unload engines first" });
});
