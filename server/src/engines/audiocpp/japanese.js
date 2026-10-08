// SPDX-License-Identifier: MIT
// The Japanese dictionary — UniDic, fetched onto this machine when the user installs it (the
// port of justvoice/engines/audiocpp/japanese.py).
//
// audio.cpp reads Japanese through MeCab over a UniDic dictionary: Kokoro's five Japanese
// voices and Chatterbox in Japanese (docs/plans/2026-10-03-gap-7-more-languages.md). The
// dictionary is an optional download of about 250 MB (decided 2026-10-03, "its own row under
// the Speech runtime row"); `runtime.js` names its folder to the runtime in
// AUDIOCPP_UNIDIC_DIR when it is here. MeCab itself (libmecab) ships inside our runtime build.
//
// unidic-lite 1.0.8 from PyPI (an MIT wrapper around UniDic 2.1.2, which is BSD / GPL / LGPL —
// taken under BSD; its licence files travel with it), pinned and verified by the sdist's
// sha256 from PyPI's own record. It is UniDic 2.1.2 with the field layout audio.cpp's Kokoro
// port reads, and the dictionary Kokoro was trained against. Only the dictionary folder and
// the licences are kept; the Python wrapper is not (no Python runs: the sdist is a tar.gz).

import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { extractTarGz } from "@delebash/llm-runner/runner/binary";
import * as download from "@delebash/llm-runner/runner/download";
import * as speechCache from "../../speech_cache.js";

export const VERSION = "1.0.8";
export const URL =
  "https://files.pythonhosted.org/packages/55/2b/8cf7514cb57d028abcef625afa847d60ff1ffbf0049c36b78faa7c35046f/" +
  `unidic-lite-${VERSION}.tar.gz`;
// The sdist's sha256 (a test assigns it — Python monkeypatched the module global).
export const cfg = { SHA256: "db9d4572d9fdd4d00a97949d4b0741ec480ee05a7e7e2e32f547500dae27b245" };
export const SHA256 = cfg.SHA256;
export const DOWNLOAD_BYTES = 47_356_746;
export const INSTALLED_BYTES = 260_467_176; // the dictionary folder, measured 2026-10-03
const DICDIR = `unidic-lite-${VERSION}/unidic_lite/dicdir`;
const LICENCES = [`unidic-lite-${VERSION}/LICENSE`, `unidic-lite-${VERSION}/LICENSE.unidic`];

export const home = (runtimeRoot) => path.join(String(runtimeRoot), "audiocpp", `unidic-lite-${VERSION}`);

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The installed dictionary folder (what AUDIOCPP_UNIDIC_DIR names), or null. */
export function dictionaryDir(runtimeRoot) {
  const root = home(runtimeRoot);
  return isFile(path.join(root, "dicrc")) ? root : null;
}

async function fileSha256(p) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(p, { highWaterMark: 1 << 20 })) h.update(chunk);
  return h.digest("hex");
}

/** Download, verify and unpack the pinned dictionary (idempotent). Returns its folder. */
export async function install(runtimeRoot, { onProgress = null, cancelCheck = null } = {}) {
  const got = dictionaryDir(runtimeRoot);
  if (got) return got;
  const root = home(runtimeRoot);
  mkdirSync(path.dirname(root), { recursive: true });
  const tarball = `${root}.tar.gz`;
  await download.streamDownload(URL, tarball, { onProgress, cancelCheck, ...speechCache._downloadKwargs() });
  const digest = await fileSha256(tarball);
  if (digest !== cfg.SHA256) {
    rmSync(tarball, { force: true });
    throw new RuntimeError(`Japanese dictionary checksum mismatch (${digest.slice(0, 12)}…) — refusing it`);
  }
  const staging = `${root}.staging`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  // Only the dictionary folder's files (at the staging root) and the licences beside them are
  // kept; the Python wrapper and setup files stay behind.
  await extractTarGz(tarball, staging, {
    members: (name) => {
      if (name.startsWith(DICDIR)) return name.slice(DICDIR.length);
      if (LICENCES.includes(name)) return path.posix.basename(name);
      return null;
    },
  });
  rmSync(tarball, { force: true });
  if (!isFile(path.join(staging, "dicrc"))) {
    rmSync(staging, { recursive: true, force: true });
    throw new RuntimeError("the Japanese dictionary unpacked without its dicrc");
  }
  rmSync(root, { recursive: true, force: true });
  renameSync(staging, root);
  return root;
}
