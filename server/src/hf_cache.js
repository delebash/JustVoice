// SPDX-License-Identifier: MIT
// HuggingFace cache probes (the port of justvoice/hf_cache.py) — used by the Engines UI's
// per-model `on_disk` flags and the capture readiness probe. A repo counts as cached when its
// snapshots dir holds at least one real weight file (HF creates the directory skeleton on
// failed downloads, so existence alone lies).

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const WEIGHT_EXTS = new Set([".safetensors", ".bin", ".onnx", ".gguf", ".npz", ".pt"]);

const HF_URL = /huggingface\.co\/([^/]+\/[^/]+)\//;

/** "org/name" from a huggingface.co resolve URL; null for non-HF urls (e.g. GitHub tarballs). */
export function repoFromUrl(url) {
  const m = HF_URL.exec(url || "");
  return m ? m[1] : null;
}

/**
 * The HF hub cache root, computed without huggingface_hub — the documented resolution order:
 * HF_HUB_CACHE → $HF_HOME/hub → ~/.cache/huggingface/hub.
 */
export function hfCacheDir() {
  const env = process.env.HF_HUB_CACHE;
  if (env) return path.normalize(env);
  const home = process.env.HF_HOME;
  if (home) return path.join(home, "hub");
  return path.join(homedir(), ".cache", "huggingface", "hub");
}

/** Python's `Path.suffix`: the last dot-part of the name, "" for none or a leading dot. */
function suffix(name) {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}

function hasWeightFile(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isFile() && WEIGHT_EXTS.has(suffix(name))) return true;
    if (st.isDirectory() && hasWeightFile(p)) return true;
  }
  return false;
}

/**
 * `root` targets a specific hub tree (each engine's legacy cache lives at
 * `<engine>/models/hf/hub`); null = the process-env resolution above. Never throws.
 */
export function isHfRepoCached(hfRepo, root = null) {
  try {
    const snaps = path.join(root ?? hfCacheDir(), `models--${hfRepo.replaceAll("/", "--")}`, "snapshots");
    if (!statSync(snaps, { throwIfNoEntry: false })?.isDirectory()) return false;
    for (const snap of readdirSync(snaps)) {
      const p = path.join(snaps, snap);
      if (statSync(p).isDirectory() ? hasWeightFile(p) : false) return true;
    }
    return false;
  } catch {
    return false;
  }
}
