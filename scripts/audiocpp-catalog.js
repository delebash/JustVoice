#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Builds the speech engine list from audio.cpp's own files (docs/plans/2026-10-11-audiocpp-
// engine-catalog.md §2): every model family audio.cpp has, read at the PINNED release tag of
// our fork's checkout beside this repo (../audio.cpp), plus each package file's size and hash at
// the pinned model revision on Hugging Face. Writes server/src/engines/audiocpp/catalog.json,
// which is committed — run this whenever the pin (engines/audiocpp/release.js) moves, and the
// diff shows exactly what the update brings.
//
//   node scripts/audiocpp-catalog.js                 the pinned tag (release.js cfg.TAG)
//   node scripts/audiocpp-catalog.js --ref <ref>     another tag or commit of the checkout
//
// Sources, each read with `git show <ref>:<path>` so the checkout's working tree doesn't matter:
//   model_specs/*.json                 family, name, description, status, tasks, languages,
//                                      capabilities, typed options, packages (audio.cpp's
//                                      docs/maintainers/model_specs.md)
//   webui/configs/models_catalog.json  each runnable entry: task, package, min_vram_gb, hint
//   webui/configs/model_params.json    control labels, ranges and help text, by entry or family
//   docs/model_licenses.md             licence, commercial use, notes, the date checked
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _entryOid, _entrySize, _revisionSha, _tree } from "@delebash/llm-runner/runner/models";
import { marked } from "marked";
import { cfg, MODEL_REPO, MODEL_REVISION } from "../server/src/engines/audiocpp/release.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CHECKOUT = resolve(ROOT, "..", "audio.cpp");
export const OUT = join(ROOT, "server", "src", "engines", "audiocpp", "catalog.json");

const git = (...args) => execFileSync("git", ["-C", CHECKOUT, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const show = (ref, path) => git("show", `${ref}:${path}`);

// The spec fields the app reads; `sources` (tensor mappings) and `dependencies` are the
// runtime's own business.
const SPEC_FIELDS = ["display_name", "description", "category", "status", "tasks", "modes", "languages", "capabilities", "runtime", "options", "ui"];

/** docs/model_licenses.md's "Families" table → family → licence row. */
export function parseLicences(markdown) {
  const link = /\[([^\]]+)\]\(([^)]+)\)/g;
  const plain = (s) => s.replace(link, "$1").replace(/<br\s*\/?>/g, "; ").replace(/`/g, "").trim();
  const links = (s) => [...s.matchAll(link)].map((m) => ({ name: m[1], url: m[2] }));
  const table = marked.lexer(markdown).find((t) => t.type === "table" && t.header[0]?.text === "Family");
  if (!table) throw new Error("docs/model_licenses.md has no Families table");
  const col = Object.fromEntries(table.header.map((h, i) => [h.text, i]));
  const out = {};
  for (const row of table.rows) {
    const cell = (name) => row[col[name]]?.text ?? "";
    const entry = {
      licence: plain(cell("License")),
      licence_links: links(cell("License")),
      commercial_use: plain(cell("Commercial use")),
      notes: plain(cell("Notes")),
      weights: links(cell("Original weights")),
      checked: plain(cell("Checked")),
    };
    for (const family of plain(cell("Family")).split(/[;,]\s*/)) if (family) out[family] = entry;
  }
  return out;
}

/** One package's download, pinned: our model repo at MODEL_REVISION, or another repo at the
 * commit its named revision resolves to today. */
async function pinnedSource(pkg, defaults, trees) {
  const dl = { ...(defaults?.download || {}), ...(pkg.download || {}) };
  const repo = dl.repo || MODEL_REPO;
  const revision = repo === MODEL_REPO ? MODEL_REVISION : await _revisionSha(repo, dl.revision || "main");
  const key = `${repo}@${revision}`;
  if (!trees.has(key)) trees.set(key, await _tree(repo, revision));
  const byPath = new Map(trees.get(key).map((e) => [e.path, e]));
  // Package files are repo paths (ours carry their folder, "IndexTTS2-GGUF/…").
  const files = (pkg.files || []).map((path) => {
    const hit = byPath.get(path);
    return hit ? { path, size_bytes: _entrySize(hit), sha256: _entryOid(hit) || null } : { path, missing: true };
  });
  return { repo, revision, kind: dl.kind || "huggingface_snapshot", gated: Boolean(dl.gated), files };
}

// Which packages a catalog entry downloads — audio.cpp's own web UI rule, ported as it is
// (../audio.cpp/webui/native/src/lib/catalog.ts `relatedPackages`, `preferredPackage`):
// an exact package id, then a legacy id that prefixes or is prefixed by a package id, then
// the packages in the entry's folder, then the whole family; the preferred one is the
// default, else Q8_0, else the first.
const PRECISION_TAIL = /_(?:q8_0|q8|f16|fp16|bf16|safetensors|orig)$/i;
const cleanId = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanPath = (v) =>
  String(v || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^models\//i, "").replace(/\/$/, "").toLowerCase();

export function relatedPackages(entry, family) {
  if (!family.length) return [];
  if (entry.family === "ace_step" || entry.family === "minimax_music3") return family;
  if (!entry.download_id) return family;
  const exact = family.find((p) => p.id === entry.download_id);
  if (exact) {
    const stem = exact.id.replace(PRECISION_TAIL, "");
    const matches = family.filter((p) => p.id.replace(PRECISION_TAIL, "") === stem);
    return matches.length ? matches : [exact];
  }
  const legacyId = cleanId(entry.download_id);
  const legacy = family.filter((p) => {
    const id = cleanId(p.id);
    return id.startsWith(legacyId) || legacyId.startsWith(id);
  });
  if (legacy.length) return legacy;
  const target = cleanPath(entry.path);
  const inFolder = family.filter((p) => cleanPath(p.target_directory) === target);
  if (inFolder.length) {
    const stems = new Set(inFolder.map((p) => p.id.replace(PRECISION_TAIL, "")));
    const matches = family.filter((p) => stems.has(p.id.replace(PRECISION_TAIL, "")));
    return matches.length ? matches : inFolder;
  }
  return family;
}

export const preferredPackage = (pkgs) => pkgs.find((p) => p.default) || pkgs.find((p) => p.precision === "q8_0") || pkgs[0];

export async function buildCatalog(ref) {
  const commit = git("rev-parse", ref).trim();
  const specFiles = git("ls-tree", "--name-only", ref, "model_specs/").trim().split("\n").filter((f) => f.endsWith(".json"));
  const entries = JSON.parse(show(ref, "webui/configs/models_catalog.json")).models;
  const params = JSON.parse(show(ref, "webui/configs/model_params.json"));
  const licences = parseLicences(show(ref, "docs/model_licenses.md"));
  const trees = new Map();
  const families = {};
  for (const file of specFiles) {
    const spec = JSON.parse(show(ref, file));
    const family = spec.family;
    const out = { family };
    for (const k of SPEC_FIELDS) if (spec[k] !== undefined) out[k] = spec[k];
    out.licence = licences[family] || null;
    out.params = params[family] || null;
    out.packages = [];
    for (const pkg of spec.packages || []) {
      const { download: _d, files: _f, ...rest } = pkg;
      out.packages.push({ ...rest, source: await pinnedSource(pkg, spec.package_defaults, trees) });
    }
    out.entries = entries
      .filter((e) => e.family === family)
      .map((e) => {
        // No download id: the weights are placed by hand (audio.cpp's built-in utilities).
        const related = e.download_id ? relatedPackages(e, spec.packages || []) : [];
        return {
          id: e.id,
          display_name: e.display_name_en || e.display_name,
          task: e.task,
          mode: e.mode,
          path: e.path || null,
          package: related.length ? preferredPackage(related).id : null,
          packages: related.map((p) => p.id),
          min_vram_gb: e.min_vram_gb ?? null,
          hint: e.input_hint_en || e.input_hint || null,
          default_text: e.default_text || null,
          params: params[e.id] || null,
        };
      });
    families[family] = out;
  }
  return {
    generated_from: { audiocpp_ref: ref, audiocpp_commit: commit, model_repo: MODEL_REPO, model_revision: MODEL_REVISION },
    families,
  };
}

async function main() {
  const at = process.argv.indexOf("--ref");
  const ref = at > 0 ? process.argv[at + 1] : cfg.TAG;
  const catalog = await buildCatalog(ref);
  writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  const fams = Object.values(catalog.families);
  const speech = fams.filter((f) => (f.tasks || []).some((t) => t === "tts" || t === "clone"));
  const missing = fams.flatMap((f) => f.packages.flatMap((p) => p.source.files.filter((x) => x.missing).map((x) => `${f.family}: ${x.path}`)));
  console.log(`${fams.length} families (${speech.length} speech) from ${ref} → ${OUT}`);
  console.log(`${fams.filter((f) => !f.licence).length} without a licence row: ${fams.filter((f) => !f.licence).map((f) => f.family).join(" ") || "none"}`);
  console.log(`${missing.length} package files not in their pinned repo`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
