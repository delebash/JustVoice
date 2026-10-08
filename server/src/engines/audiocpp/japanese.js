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
import { closeSync, createReadStream, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
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

const nts = (b) => {
  const i = b.indexOf(0);
  return (i >= 0 ? b.subarray(0, i) : b).toString("utf8");
};
const octal = (b) => {
  const s = nts(b).trim();
  return s ? Number.parseInt(s, 8) : 0;
};

/**
 * tarfile's walk of a .tar.gz, keeping only regular files (`member.isfile()`) whose name has
 * no ".." part and that `map(name)` places (a relative path under `dest`; null = skip). Reads
 * ustar, GNU long names and pax path/size records. Its own walk rather than the kit's
 * `extractTarGz`: that one unpacks everything, and leaves the archive open when it stops at
 * the end-of-archive marker (Windows then keeps the tarball "delete pending").
 */
async function extractMembers(tarball, map, dest) {
  let buf = Buffer.alloc(0);
  let cur = null; // {fd, remaining, pad}
  let pending = {}; // the next member's long name / pax overrides
  let ended = false;
  const take = async (source) => {
    for await (const chunk of source) {
      if (ended) continue; // drain: the pipeline closes every stream when the source ends
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      for (;;) {
        if (cur) {
          const n = Math.min(cur.remaining, buf.length);
          if (n > 0) {
            if (cur.fd !== null) writeSync(cur.fd, buf.subarray(0, n));
            else if (cur.collect) cur.collect.push(Buffer.from(buf.subarray(0, n)));
            cur.remaining -= n;
            buf = buf.subarray(n);
          }
          if (cur.remaining > 0 || buf.length < cur.pad) break;
          buf = buf.subarray(cur.pad);
          if (cur.fd !== null) closeSync(cur.fd);
          if (cur.done) cur.done(Buffer.concat(cur.collect));
          cur = null;
          continue;
        }
        if (buf.length < 512) break;
        const hdr = buf.subarray(0, 512);
        buf = buf.subarray(512);
        if (hdr.every((x) => x === 0)) {
          ended = true;
          break;
        }
        const type = String.fromCharCode(hdr[156] || 0x30);
        let name = nts(hdr.subarray(0, 100));
        if (hdr.subarray(257, 262).toString("latin1") === "ustar" && !"LK".includes(type)) {
          const prefix = nts(hdr.subarray(345, 500));
          if (prefix) name = `${prefix}/${name}`;
        }
        let size = octal(hdr.subarray(124, 136));
        const pad = (512 - (size % 512)) % 512;
        if (type === "L" || type === "x" || type === "g") {
          // GNU long name / pax records: collected, applied to the next member.
          cur = {
            fd: null,
            remaining: size,
            pad,
            collect: [],
            done: (data) => {
              if (type === "L") pending.name = nts(data);
              else {
                let p = 0;
                while (p < data.length) {
                  const sp = data.indexOf(0x20, p);
                  if (sp < 0) break;
                  const len = Number.parseInt(data.subarray(p, sp).toString("ascii"), 10);
                  if (!len) break;
                  const rec = data.subarray(sp + 1, p + len - 1).toString("utf8");
                  const eq = rec.indexOf("=");
                  if (eq > 0 && (rec.slice(0, eq) === "path" || rec.slice(0, eq) === "size")) pending[rec.slice(0, eq)] = rec.slice(eq + 1);
                  p += len;
                }
              }
            },
          };
          continue;
        }
        if (pending.name) name = pending.name;
        if (pending.path) name = pending.path;
        if (pending.size) size = Number(pending.size);
        pending = {};
        const isFileMember = type === "0" || type === "\0" || type === "7";
        name = name.replaceAll("\\", "/");
        const rel = isFileMember && !name.split("/").includes("..") ? map(name) : null;
        let fd = null;
        if (rel) {
          const out = path.join(dest, ...rel.split("/"));
          mkdirSync(path.dirname(out), { recursive: true });
          fd = openSync(out, "w");
        }
        cur = { fd, remaining: size, pad: (512 - (size % 512)) % 512, collect: null, done: null };
      }
    }
  };
  try {
    await pipeline(createReadStream(tarball), createGunzip(), take);
  } finally {
    if (cur?.fd != null) closeSync(cur.fd);
  }
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
  await extractMembers(tarball, (name) => {
    if (name.startsWith(DICDIR)) return name.slice(DICDIR.length);
    if (LICENCES.includes(name)) return path.posix.basename(name);
    return null;
  }, staging);
  rmSync(tarball, { force: true });
  if (!isFile(path.join(staging, "dicrc"))) {
    rmSync(staging, { recursive: true, force: true });
    throw new RuntimeError("the Japanese dictionary unpacked without its dicrc");
  }
  rmSync(root, { recursive: true, force: true });
  renameSync(staging, root);
  return root;
}
