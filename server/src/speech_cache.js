// SPDX-License-Identifier: MIT
// The speech-model cache — plain files plus a written manifest (the port of
// justvoice/speech_cache.py).
//
// Phase ② of the 2026-08-13 speech redesign (plan doc §12): speech engines' model files live at
// `<data_dir>/speech-cache/<engine>/<variant>/` as PLAIN files at their repo-relative paths,
// with one `files.json` per variant as the on-disk truth:
//
//     {"sources": [{"hf_repo": "...", "revision": "...", "commit_sha": "..."}],
//      "fetched_at": 1755150000000,
//      "files": [{"path": "...", "size": 123, "oid": "..."}, ...]}
//
// Design points, each deliberate:
// - NO HF hub-cache layout — no blobs, no snapshots, no symlink-or-copy machinery.
// - Downloads ride the KIT's chunked downloader (`streamDownload`: resumable parts, per-chunk
//   retry, the shared 429 rate gate) resolved by the kit's `selectRepoFiles` (explicit pinned
//   file lists; a missing name fails loud). File URLs pin the RESOLVED commit sha, so a moving
//   branch can't tear a download.
// - `variantOnDisk` verifies every manifest file exists at its recorded size (stat, no
//   hashing).
// - Multi-repo variants nest one subdir per repo under the variant dir (`<owner>--<name>/`);
//   single-repo variants keep their files at the variant root — the folder the speech
//   runtime's config points into. `variantFilePath` is where a file of either is, for the
//   runtime's registration (QwenCleo-ASR and its aligner, two repositories).

import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Mutex } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { pyInt, RuntimeError } from "@delebash/llm-runner/platform/py";
import * as download from "@delebash/llm-runner/runner/download";
import * as lifecycle from "@delebash/llm-runner/runner/lifecycle";
import * as kitModels from "@delebash/llm-runner/runner/models";
import { speechCacheRoot } from "./paths.js";
import * as self from "./speech_cache.js";
import { atomicWriteJson } from "./storage/atomic.js";

const log = getLogger("justvoice.speech_cache");

export const MANIFEST_NAME = "files.json";
const HF_BASE = "https://huggingface.co";

// A variant whose files are another engine's variant's: one copy on disk, in the owner's folder
// (a family that speaks and recognises speech from one package — FireRedAudio, LFM2.5-Audio — is
// a speech engine and a recognition engine; engines/audiocpp/generated.js registers them).
// "<engine>/<variant>" → [owner engine, owner variant].
const SHARED = new Map();

/** `engineId`'s `variantId` keeps its files in `ownerEngine`'s `ownerVariant` folder. */
export function shareVariantFiles(engineId, variantId, ownerEngine, ownerVariant) {
  SHARED.set(`${engineId}/${variantId}`, [ownerEngine, ownerVariant]);
}

/** [engine, variant] whose folder holds this variant's files. */
export const filesOwner = (engineId, variantId) => SHARED.get(`${engineId}/${variantId}`) ?? [engineId, variantId];

/** The variants of `engineId` whose files are in another engine's folder, by variant id. */
export function sharedVariantsOf(engineId) {
  return [...SHARED.keys()].filter((k) => k.startsWith(`${engineId}/`)).map((k) => k.slice(engineId.length + 1));
}

export function variantDir(dataDir, engineId, variantId) {
  const [owner, ownerVariant] = filesOwner(engineId, variantId);
  return path.join(speechCacheRoot(String(dataDir)), owner, ownerVariant);
}

/** The variant's files.json, or null (absent/unreadable — not truth). */
export function readManifest(vdir) {
  try {
    return JSON.parse(readFileSync(path.join(String(vdir), MANIFEST_NAME), "utf8"));
  } catch {
    return null;
  }
}

/** The on-disk truth: a manifest exists and EVERY file it names exists at its recorded size.
 * Anything less is false — a half-fetched variant never reads as installed. */
export function variantOnDisk(dataDir, engineId, variantId) {
  const vdir = variantDir(dataDir, engineId, variantId);
  const man = readManifest(vdir);
  if (!man || typeof man !== "object") return false;
  const files = man.files || [];
  for (const f of files) {
    try {
      const st = statSync(path.join(vdir, f.path));
      if (!st.isFile() || st.size !== pyInt(f.size)) return false;
    } catch {
      return false;
    }
  }
  return files.length > 0;
}

/** True when at least one of this engine's variants is COMPLETE in the cache. */
export function anyVariantOnDisk(dataDir, engineId) {
  const root = path.join(speechCacheRoot(String(dataDir)), engineId);
  let children;
  try {
    children = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    children = [];
  }
  return [...children, ...sharedVariantsOf(engineId)].some((name) => self.variantOnDisk(dataDir, engineId, name));
}

/** The folder a variant's source `i` of `sources` is fetched into, relative to the variant's
 * folder: its repository's own (`<owner>--<name>`) when the variant has more than one source,
 * else the variant's folder itself (""). */
export function sourceFolder(sources, i) {
  return sources.length > 1 ? String(sources[i].hf_repo).replaceAll("/", "--") : "";
}

/**
 * Where `file` — a path in one of the variant's `sources` (its repository's own path) — is on
 * disk: under that source's folder (`sourceFolder`), named by the repository the variant's
 * files.json says it was fetched from (an operator's mirror replaces each one), else by
 * `sources`. A file no source lists is at the variant's folder. The speech runtime registers a
 * model by this path (slot._entriesFor); until 2026-10-16 it joined the variant's folder and the
 * file, so QwenCleo-ASR's model — in its repository's folder beside the aligner's — was missing.
 */
export function variantFilePath(dataDir, engineId, variantId, sources, file) {
  const vdir = variantDir(dataDir, engineId, variantId);
  const list = sources || [];
  const i = list.findIndex((s) => (s.files || []).includes(file));
  if (i < 0 || list.length < 2) return path.join(vdir, file);
  const fetched = readManifest(vdir)?.sources;
  const from = Array.isArray(fetched) && fetched.length === list.length ? fetched : list;
  return path.join(vdir, sourceFolder(from, i), file);
}

/** Recorded total bytes of the variant (manifest sum; 0 when absent). */
export function variantDiskBytes(dataDir, engineId, variantId) {
  const man = readManifest(variantDir(dataDir, engineId, variantId));
  if (!man) return 0;
  return (man.files || []).reduce((s, f) => s + pyInt(f.size || 0), 0);
}

/** The kit's per-download settings from the runner config when the shared service is wired;
 * plain defaults otherwise. */
export function _downloadKwargs() {
  try {
    return download.downloadKwargs(lifecycle.getService().config());
  } catch {
    return { segments: 8, retries: 3 }; // bare tests / standalone
  }
}

// One fetch per variant at a time: a Download and a Load of the same model (or two loads) used
// to download the same file at once, the second deleting what the first had just finished
// (audit 2026-10-04 §5 E6).
const FETCH_LOCKS = new Map();
function fetchLock(engineId, variantId) {
  // By the folder the files go to: two engines sharing one copy fetch it once.
  const key = filesOwner(engineId, variantId).join("/");
  if (!FETCH_LOCKS.has(key)) FETCH_LOCKS.set(key, new Mutex());
  return FETCH_LOCKS.get(key);
}

/**
 * Fetch a variant's pinned files into the speech cache and write its manifest. `sources` rows:
 * `{hf_repo, revision|null, files: [paths]|null}` — null files = the whole repo tree.
 * Multi-source variants nest per-repo subdirs. Progress is cumulative bytes across every file
 * of every source, against the RESOLVED real total. Throws the kit's DownloadCancelled on
 * cancel; already-present files at the right size are skipped (resume/idempotent). Returns
 * the written manifest.
 */
export async function fetchHfVariant(dataDir, engineId, variantId, sources, { onProgress = null, cancelCheck = null } = {}) {
  return fetchLock(engineId, variantId).run(() => fetchHfVariantLocked(dataDir, engineId, variantId, sources, { onProgress, cancelCheck }));
}

async function fileSha256(p) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(p, { highWaterMark: 1 << 20 })) h.update(chunk);
  return h.digest("hex");
}

/** A large file's oid on Hugging Face is the sha256 of its content: check it, and refuse (and
 * delete) a file that doesn't match. A git blob's oid (40 hex) is not a content hash of the
 * file, so it is not checked. Files were checked by size only until 2026-10-04. */
export async function _verifyLfsSha256(p, oid) {
  if (!oid || oid.length !== 64) return;
  const digest = await fileSha256(p);
  if (digest.toLowerCase() !== oid.toLowerCase()) {
    rmSync(p, { force: true });
    throw new RuntimeError(`${path.basename(String(p))} does not match its published checksum — it was deleted; download it again`);
  }
}

const isSizedFile = (p, size) => {
  try {
    const st = statSync(p);
    return st.isFile() && st.size === size;
  } catch {
    return false;
  }
};

async function fetchHfVariantLocked(dataDir, engineId, variantId, sources, { onProgress, cancelCheck }) {
  const vdir = variantDir(dataDir, engineId, variantId);
  mkdirSync(vdir, { recursive: true });
  const headers = kitModels.hfDownloadHeaders();
  const kwargs = self._downloadKwargs();

  // Resolve every source first: real sizes give the bar its denominator, and a bad repo/file
  // list fails before any byte moves.
  const resolved = [];
  let total = 0;
  for (const [i, src] of sources.entries()) {
    const repo = src.hf_repo;
    const revision = src.revision || "main";
    const [sha, entries] = await kitModels.selectRepoFiles(repo, { revision, files: src.files ?? null });
    resolved.push([src, sha, entries, sourceFolder(sources, i)]);
    total += entries.reduce((s, e) => s + kitModels._entrySize(e), 0);
  }
  if (onProgress) onProgress(0, total);

  let done = 0;
  const recorded = [];
  for (const [src, sha, entries, folder] of resolved) {
    const repo = src.hf_repo;
    for (const e of entries) {
      const p = e.path;
      const size = kitModels._entrySize(e);
      const rel = folder ? `${folder}/${p}` : p;
      const dest = path.join(vdir, ...rel.split("/"));
      recorded.push({ path: rel, size, oid: kitModels._entryOid(e) });
      if (isSizedFile(dest, size)) {
        done += size;
        if (onProgress) onProgress(done, total);
        continue;
      }
      // Pin the resolved sha, not the symbolic revision — a branch moving mid-fetch cannot
      // tear the variant.
      const url = `${HF_BASE}/${repo}/resolve/${sha}/${p}`;
      const base = done;
      await download.streamDownload(url, dest, {
        onProgress: onProgress ? (n, _t) => onProgress(base + n, total) : null,
        cancelCheck,
        headers,
        ...kwargs,
      });
      await self._verifyLfsSha256(dest, kitModels._entryOid(e));
      done += size;
      if (onProgress) onProgress(done, total);
    }
  }

  const manifest = {
    sources: resolved.map(([s, sha]) => ({ hf_repo: s.hf_repo, revision: s.revision || "main", commit_sha: sha })),
    fetched_at: Date.now(),
    files: recorded,
  };
  atomicWriteJson(path.join(vdir, MANIFEST_NAME), manifest);
  log.debug(`fetched ${engineId}/${variantId}: ${recorded.length} file(s), ${total} bytes`);
  return manifest;
}
