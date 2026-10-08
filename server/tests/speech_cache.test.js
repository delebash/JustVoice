// SPDX-License-Identifier: MIT
// The speech-model cache (phase ②a, plan doc §12): plain files + files.json truth — fetch via
// the kit resolver/downloader (faked here, offline), the on-disk verification, multi-repo
// nesting (the port of tests/test_speech_cache.py).
import { mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FileNotFoundError } from "@delebash/llm-runner/platform/py";
import * as dl from "@delebash/llm-runner/runner/download";
import * as km from "@delebash/llm-runner/runner/models";
import { beforeEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as sc from "../src/speech_cache.js";
import { tmpPath } from "./helpers.js";

/** selectRepoFiles stand-in: trees = {repo: [[path, size, oid], ...]}. */
function fakeResolver(trees) {
  return async (repo, { revision = "main", files = null } = {}) => {
    let entries = trees[repo].map(([p, size, oid]) => ({ path: p, size, oid }));
    if (files !== null) {
      const by = new Map(entries.map((e) => [e.path, e]));
      const missing = files.filter((f) => !by.has(f));
      if (missing.length) throw new FileNotFoundError(missing.join(", "));
      entries = files.map((f) => by.get(f));
    }
    void revision;
    return [`sha-${repo.split("/").pop()}`, entries];
  };
}

let calls;
beforeEach(() => {
  calls = [];
  const trees = {
    "owner/repo": [
      ["model-4.bin", 4, "oid-a"],
      ["cfg-2.bin", 2, "oid-b"],
    ],
    "owner/codec": [["enc-3.bin", 3, "oid-c"]],
  };
  vi.spyOn(km, "selectRepoFiles").mockImplementation(fakeResolver(trees));
  vi.spyOn(dl, "streamDownload").mockImplementation(async (url, dest, { onProgress } = {}) => {
    mkdirSync(path.dirname(dest), { recursive: true });
    // Size rides the URL's filename in these fixtures: name-<size>.bin
    const size = Number.parseInt(url.slice(url.lastIndexOf("-") + 1).split(".")[0], 10);
    writeFileSync(dest, Buffer.alloc(size));
    calls.push(url);
    if (onProgress) onProgress(size, size);
  });
  vi.spyOn(sc, "_downloadKwargs").mockReturnValue({ segments: 1, retries: 0 });
});

test("fetch_writes_files_and_manifest", async () => {
  const tmp = tmpPath();
  const progress = [];
  const man = await sc.fetchHfVariant(tmp, "eng", "v1", [{ hf_repo: "owner/repo", files: null }], {
    onProgress: (d, t) => progress.push([d, t]),
  });
  const vdir = sc.variantDir(tmp, "eng", "v1");
  expect(statSync(path.join(vdir, "model-4.bin")).size).toBe(4);
  expect(statSync(path.join(vdir, "cfg-2.bin")).size).toBe(2);
  expect(man.sources).toEqual([{ hf_repo: "owner/repo", revision: "main", commit_sha: "sha-repo" }]);
  expect(man.files.map((f) => f.path)).toEqual(["model-4.bin", "cfg-2.bin"]);
  // URLs pin the RESOLVED sha, never the symbolic revision.
  expect(calls.every((u) => u.includes("/resolve/sha-repo/"))).toBe(true);
  // Progress: denominator is the resolved total, final tick is complete.
  expect(progress[0]).toEqual([0, 6]);
  expect(progress[progress.length - 1]).toEqual([6, 6]);
  expect(sc.variantOnDisk(tmp, "eng", "v1")).toBe(true);
  expect(sc.variantDiskBytes(tmp, "eng", "v1")).toBe(6);
});

test("fetch_skips_files_already_at_size", async () => {
  const tmp = tmpPath();
  const vdir = sc.variantDir(tmp, "eng", "v1");
  mkdirSync(vdir, { recursive: true });
  writeFileSync(path.join(vdir, "model-4.bin"), Buffer.alloc(4)); // complete → skipped
  await sc.fetchHfVariant(tmp, "eng", "v1", [{ hf_repo: "owner/repo", files: null }]);
  expect(calls.length).toBe(1);
  expect(calls[0]).toContain("cfg-2.bin");
});

test("multi_source_nests_per_repo", async () => {
  const tmp = tmpPath();
  const man = await sc.fetchHfVariant(tmp, "eng", "v1", [
    { hf_repo: "owner/repo", files: ["model-4.bin"] },
    { hf_repo: "owner/codec", files: null },
  ]);
  const vdir = sc.variantDir(tmp, "eng", "v1");
  expect(statSync(path.join(vdir, "owner--repo", "model-4.bin")).isFile()).toBe(true);
  expect(statSync(path.join(vdir, "owner--codec", "enc-3.bin")).isFile()).toBe(true);
  expect(new Set(man.files.map((f) => f.path))).toEqual(new Set(["owner--repo/model-4.bin", "owner--codec/enc-3.bin"]));
  expect(sc.variantOnDisk(tmp, "eng", "v1")).toBe(true);
});

test("on_disk_is_size_exact_never_folder_non_empty", async () => {
  const tmp = tmpPath();
  await sc.fetchHfVariant(tmp, "eng", "v1", [{ hf_repo: "owner/repo", files: null }]);
  const vdir = sc.variantDir(tmp, "eng", "v1");
  writeFileSync(path.join(vdir, "model-4.bin"), Buffer.alloc(3)); // truncated
  expect(sc.variantOnDisk(tmp, "eng", "v1")).toBe(false);
  unlinkSync(path.join(vdir, "model-4.bin")); // missing
  expect(sc.variantOnDisk(tmp, "eng", "v1")).toBe(false);
  // No manifest at all — a bare non-empty folder is NOT installed.
  const vdir2 = sc.variantDir(tmp, "eng", "v2");
  mkdirSync(vdir2, { recursive: true });
  writeFileSync(path.join(vdir2, "junk.onnx"), "x");
  expect(sc.variantOnDisk(tmp, "eng", "v2")).toBe(false);
});

test("missing_pinned_file_fails_before_any_byte", async () => {
  const tmp = tmpPath();
  await expect(sc.fetchHfVariant(tmp, "eng", "v1", [{ hf_repo: "owner/repo", files: ["nope.bin"] }])).rejects.toThrow(/nope\.bin/);
  expect(calls).toEqual([]); // fail-loud resolve — nothing streamed
});
