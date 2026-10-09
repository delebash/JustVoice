// SPDX-License-Identifier: MIT
// Voice bundles — a voice travels as one file (C4, 2026-08-21 go) — the port of
// justvoice/voice_bundle.py.
//
// A bundle is a ZIP holding `voice.json` (the record's portable facts) and the reference clip
// when the voice has one. What travels is what the voice IS on its engine:
//
//   * cloned / imported — the reference clip; re-clones on any cloning-capable engine, so the
//     bundle carries its engine as the DEFAULT, not a prison.
//   * designed — the description; renders on any voice-design engine.
//   * blended — the mixed vector (kokoro-space numbers): meaningful only on the engine that
//     mixed it, and the import refuses any other.
//   * preset — NOT bundled: a preset ships with its engine — there is nothing of yours to carry.
//
// It carries the voice's id (since 2026-10-08): an import keeps it when this install has no voice
// by that id, so a voice moved to another computer is the same voice there — the personas that
// sync with it (server/src/sync.js; voices themselves don't sync) find it. Imported twice on one
// computer, or a bundle from before, it gets a new id as always.
//
// It also carries the model the voice was made for (the capability row id, e.g.
// "chatterbox-turbo") and Qwen3 Base's "skip the words" mode — until 2026-10-05 it left both
// out, so an imported voice spoke on its engine's default model. A model this install doesn't
// know is kept by name and refused at load, as for any stored voice
// (`voice_model.modelForStored`).
//
// Pure logic over a voices-store-shaped object (`get`, `create`, `refWavPath`, `writeRefWav`)
// — the API route stays thin and the round-trip pins run against a fake store.
//
// The ZIP is the kit's platform/zip — Python's `zipfile` over a BytesIO (`writestr`, `read`);
// Python reads these bundles and these read Python's.

import { readFileSync, statSync } from "node:fs";
import { strip, ValueError } from "@delebash/llm-runner/platform/py";
import { pyFloatValue, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { BadZipFile, ZipReader, ZipWriter } from "@delebash/llm-runner/platform/zip";
import { LookupError } from "./engines/blending.js";
import { BlendRecipe, construct, floatify, utcNow, VoiceRecord } from "./models.js";

export { LookupError };

export const FORMAT = "justvoice-voice-bundle/1";

const _BUNDLEABLE = new Set(["cloned", "designed", "imported", "blended"]);
const _MAX_BUNDLE_BYTES = 500 * 1024 * 1024; // a ref clip is capped far below this

// ── the bundle ────────────────────────────────────────────────────────────────

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `str.isalnum()` for one character (letters and numbers, any script). */
const isAlnum = (c) => /^[\p{L}\p{N}]$/u.test(c);

/** `[zip bytes, suggested filename]`. Throws LookupError / ValueError with the user-facing
 * reason. */
export function buildBundle(voicesStore, voiceId) {
  const rec = voicesStore.get(voiceId);
  if (rec == null) throw new LookupError(`voice '${voiceId}' not found`);
  if (!_BUNDLEABLE.has(rec.source)) throw new ValueError("preset voices ship with their engine — nothing to export");

  const manifest = {
    format: FORMAT,
    id: rec.id,
    engine: rec.engine,
    model: rec.model ?? null,
    xvector_only: rec.xvector_only ?? false,
    source: rec.source,
    name: rec.name,
    language: rec.language,
    gender: rec.gender ?? null,
    design_prompt: rec.design_prompt ?? null,
    transcript: rec.transcript ?? null,
    // Python's floats: the vector's numbers and the recipe's weights print as Python prints them.
    embedding: rec.embedding != null ? rec.embedding.map((v) => pyFloatValue(v)) : null,
    blend_recipe: rec.blend_recipe ? floatify(BlendRecipe, construct(BlendRecipe, rec.blend_recipe)) : null,
  };
  const files = [["voice.json", pyJson(manifest, { indent: 2, ensureAscii: false })]];
  const ref = String(voicesStore.refWavPath(voiceId));
  if (isFile(ref)) files.push(["ref.wav", readFileSync(ref)]);

  const safe = strip([...rec.name].map((c) => (isAlnum(c) || "-_ ".includes(c) ? c : "_")).join("")) || voiceId;
  const zip = new ZipWriter();
  for (const [name, data] of files) zip.writestr(name, data);
  return [zip.toBuffer(), `${safe}.jvvoice.zip`];
}

/** Recreate the voice from a bundle → the stored VoiceRecord. Throws ValueError with the reason
 * on anything unusable — a half-imported voice is worse than a refusal. `knownEngines` is a Set
 * (or an array) of engine ids. */
export function importBundle(voicesStore, payload, { knownEngines }) {
  const known = knownEngines instanceof Set ? knownEngines : new Set(knownEngines || []);
  if (payload.length > _MAX_BUNDLE_BYTES) throw new ValueError("bundle is larger than the 500 MB limit");
  let z;
  try {
    z = ZipReader.fromBuffer(payload);
  } catch (e) {
    if (e instanceof BadZipFile) throw new ValueError("that file is not a voice bundle (not a ZIP)");
    throw e;
  }

  const names = new Map(z.names().map((n) => [n.split("/").pop(), n]));
  if (!names.has("voice.json")) throw new ValueError("no voice.json in the bundle — not a JustVoice voice export");
  let m;
  try {
    m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(z.read(names.get("voice.json"))));
  } catch {
    throw new ValueError("the bundle's voice.json is not valid JSON");
  }
  if (m === null || typeof m !== "object" || Array.isArray(m)) m = {};
  if (m.format !== FORMAT) {
    throw new ValueError(`unrecognised bundle format ${reprOf(m.format)} — this build reads ${FORMAT}`);
  }

  const source = m.source ?? null;
  if (!_BUNDLEABLE.has(source)) throw new ValueError(`bundles cannot carry a ${reprOf(source)} voice`);
  const engine = strip(m.engine || "");
  if (!known.has(engine)) {
    throw new ValueError(`this voice belongs to engine '${engine}', which this install doesn't have — install it first, then import again`);
  }
  const ref = names.has("ref.wav") ? z.read(names.get("ref.wav")) : null;
  if ((source === "cloned" || source === "imported") && !(ref && ref.length)) {
    throw new ValueError("this voice is made of a reference clip, but the bundle has none");
  }
  if (source === "designed" && !strip(m.design_prompt || "")) {
    throw new ValueError("a designed voice needs its description, and the bundle has none");
  }
  if (source === "blended" && !(Array.isArray(m.embedding) ? m.embedding.length : m.embedding)) {
    throw new ValueError("a blended voice needs its mixed vector, and the bundle has none");
  }

  const now = utcNow();
  // the voice's own id when it's free here and safe as a folder name; a new one otherwise
  const ownId = typeof m.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(m.id) && voicesStore.get(m.id) == null ? m.id : "";
  const rec = construct(VoiceRecord, {
    id: ownId,
    engine,
    model: m.model || null,
    xvector_only: Boolean(m.xvector_only),
    source,
    name: m.name || "Imported voice",
    language: m.language || "en-US",
    gender: m.gender ?? null,
    design_prompt: m.design_prompt ?? null,
    transcript: m.transcript ?? null,
    embedding: m.embedding ?? null,
    blend_recipe: m.blend_recipe ? construct(BlendRecipe, m.blend_recipe) : null,
    created_at: now,
    updated_at: now,
  });
  const created = voicesStore.create(rec);
  if (ref && ref.length) voicesStore.writeRefWav(created.id, ref);
  return created;
}

/** Python's `{x!r}` for the values a bundle's manifest holds (a string, null, a number). */
function reprOf(v) {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return `'${v.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  if (v === true) return "True";
  if (v === false) return "False";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}
