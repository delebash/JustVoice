// SPDX-License-Identifier: MIT
// A model's load options — audio.cpp's session options, read when the model loads — set on each
// model row of Speech engines, saved in `engine_overrides[engine].runtime_options[model]` (only
// values other than the default), and passed as the model's session options when it is
// registered. A change reloads a loaded model (api/models_api.js).
//
// Every option the family's spec lists (its `options.session`, catalog.json), at audio.cpp's own
// default — the adoption plan's E4 (docs/plans/2026-10-13-adopt-everything-audiocpp.md §3; was:
// only the two Qwen3 options whose effect was measured, audit 2026-10-04 §13.5, until the
// narrowings review's E4/F1). audio.cpp's own UI folds its model's options the same way ("Model
// parameters", webui/native/src/routes/+page.svelte). A session option is a local name in the
// spec; its key is `<family>.<name>` (audio.cpp's docs/maintainers/model_specs.md). Left out: a
// file on the server's disk (the spec's path types — the app gives those: a companion it
// downloads, eSpeak NG), and an option the app sets for the row itself (`session_files`,
// `session_options`).
//
// What JustVoice knows about an option is its family file's `LOAD_OPTIONS`
// (curated/<family>.js): its words, a value audio.cpp refuses on some weights, a default of the
// app's own. Such an option shows on the row itself; the rest are folded. Each option has its
// `default` (what the model loads with when nothing is set: the app's, else audio.cpp's, else
// none) and audio.cpp's own `runtime_default` (never sent). They differ for Qwen3's decoder
// weights: 16-bit is the app's default (approved 2026-10-04) and is sent unless 32-bit is chosen.
//
// Values are text, as audio.cpp reads a session option (`json_options_map`): "true"/"false", a
// number's digits, a word.

import { ValueError } from "@delebash/llm-runner/platform/py";
import * as appState from "../../app_state.js";
import { CURATED } from "./curated/index.js";
import { catalogFamily, english, humanize, isFileOption, sessionOptionsOf } from "./generated.js";
import * as self from "./runtime_options.js";

// The spec's option types → the control the row shows.
const CONTROL = { enum: "choice", bool: "switch", boolean: "switch", int: "number", float: "number", number: "number" };

// The catalog's own mark: every 8-bit row's id ends "-q8" (`release.sixteenBit` swaps it for
// the 16-bit sibling's). A file name is not one — Base 1.7B's is "…-q8_0_v2.gguf".
const is8bit = (row) => String(row.id ?? "").endsWith("-q8");

/** A spec default as the text audio.cpp reads, or null. */
const asText = (v) => (v === undefined || v === null || v === "" ? null : typeof v === "boolean" ? String(v) : String(v));

/** audio.cpp's own control for a load option, where its control list has one (`scope:
 * "session"` in webui/configs/model_params.json) — its label and help. */
function controlOf(fam, key, name) {
  const params = [...(fam.params || []), ...fam.entries.flatMap((e) => e.params || [])];
  return params.find((p) => p.scope === "session" && (p.session_option === key || p.name === name || p.name === key)) ?? null;
}

/** The load options a manifest row's model takes, each {key, name, type, label, hint, choices,
 * min, max, integer, default, runtime_default, featured}. */
export function offeredFor(row) {
  const family = (row.audiocpp || {}).family;
  const fam = family ? catalogFamily(family) : null;
  if (!fam) return [];
  const known = CURATED[family]?.LOAD_OPTIONS || {};
  // What the app sets for this row itself.
  const appSets = new Set([...Object.keys(row.audiocpp.session_options || {}), ...Object.keys(row.audiocpp.session_files || {})]);
  const out = [];
  for (const o of sessionOptionsOf(family)) {
    const key = `${family}.${o.name}`;
    if (isFileOption(o) || appSets.has(key)) continue;
    const k = known[o.name] ?? null;
    if (k?.only_8bit && !is8bit(row)) continue;
    const type = CONTROL[o.type] ?? "text";
    // A choice's words: its spec's values (a preset's written out by the catalog script).
    if (type === "choice" && !(Array.isArray(o.values) && o.values.length)) continue;
    const p = controlOf(fam, key, o.name);
    const runtimeDefault = asText(o.default);
    out.push({
      key,
      name: o.name,
      type,
      label: k?.label || english(p?.label_en, p?.label) || humanize(o.name),
      hint: k?.hint || english(p?.info_en, p?.info, o.description),
      choices: type === "choice" ? o.values.map((v) => [String(v), k?.choices?.[String(v)] ?? String(v)]) : [],
      min: type === "number" ? (o.min ?? null) : null,
      max: type === "number" ? (o.max ?? null) : null,
      integer: o.type === "int",
      default: k && Object.hasOwn(k, "default") ? asText(k.default) : runtimeDefault,
      runtime_default: runtimeDefault,
      featured: k !== null,
    });
  }
  return out;
}

/** `raw` as the text audio.cpp reads for option `o`, or undefined when it doesn't fit: a choice
 * one of its words, a switch "true" or "false", a number within the spec's ends (a whole one for
 * an integer — rounded, and brought to an end it passes, as the request's settings are). */
export function coerce(o, raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).trim();
  if (o.type === "choice") return o.choices.some(([c]) => c === s) ? s : undefined;
  if (o.type === "switch") {
    if (["true", "1", "on", "yes"].includes(s.toLowerCase())) return "true";
    if (["false", "0", "off", "no"].includes(s.toLowerCase())) return "false";
    return undefined;
  }
  if (o.type === "number") {
    let n = Number(s);
    if (!Number.isFinite(n)) return undefined;
    if (o.integer) n = Math.round(n);
    if (o.min !== null) n = Math.max(o.min, n);
    if (o.max !== null) n = Math.min(o.max, n);
    return String(n);
  }
  return s;
}

/** What the user set for this model (only non-default values are kept). */
export function savedFor(engineId, variantId) {
  let ov;
  try {
    ov = appState.getState().settings.get().engines.engine_overrides[engineId];
  } catch {
    return {}; // no app state (unit tests): nothing set
  }
  return { ...((ov ? ov.runtime_options[variantId] : null) || {}) };
}

/** Every option the row takes, at the value it loads with: what the user saved, else the
 * default (null = none: audio.cpp decides). A value saved for an option the row no longer
 * offers, or that no longer fits it, is dropped. */
export function chosenFor(engineId, row) {
  const saved = self.savedFor(engineId, row.id);
  const out = {};
  for (const o of offeredFor(row)) {
    const value = Object.hasOwn(saved, o.key) ? coerce(o, saved[o.key]) : undefined;
    out[o.key] = value !== undefined ? value : o.default;
  }
  return out;
}

/** What `_entriesFor` passes at registration: each chosen value that isn't audio.cpp's own
 * default (16-bit Decoder weights is sent unless 32-bit is chosen). */
export function sessionOptionsFor(engineId, row) {
  const runtimeDefault = Object.fromEntries(offeredFor(row).map((o) => [o.key, o.runtime_default]));
  return Object.fromEntries(Object.entries(chosenFor(engineId, row)).filter(([k, v]) => v !== null && v !== runtimeDefault[k]));
}

/** The load-option set a model's memory price is kept under (§7 question 3, decided 2026-10-15:
 * a price per load-option set, measured the first time each is used): the values chosen other
 * than the defaults, as "key=value" in key order — "" for the default set, whose prices were
 * measured before this key existed. */
export function priceKeyFor(engineId, row) {
  const defaults = Object.fromEntries(offeredFor(row).map((o) => [o.key, o.default]));
  return Object.entries(chosenFor(engineId, row))
    .filter(([k, v]) => v !== null && v !== defaults[k])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}

/** `values` checked against what the row offers; values at the default (or empty: back to it)
 * dropped — nothing saved is the default. Throws ValueError naming the first bad key or value. */
export function validate(row, values) {
  const offered = Object.fromEntries(offeredFor(row).map((o) => [o.key, o]));
  const out = {};
  for (const [key, raw] of Object.entries(values)) {
    const opt = offered[key];
    if (opt === undefined) throw new ValueError(`${row.name ?? row.id} has no runtime option ${key}`);
    if (raw === null || raw === undefined || String(raw).trim() === "") continue;
    const value = coerce(opt, raw);
    if (value === undefined) {
      const allowed = opt.type === "switch" ? ["true", "false"] : opt.choices.map(([c]) => c);
      throw new ValueError(opt.type === "number" ? `${opt.label} must be a number` : `${opt.label} must be one of ${allowed.join(", ")}`);
    }
    if (value !== opt.default) out[key] = value;
  }
  return out;
}

/** The row's options with their current values — the model row reads this (the `RuntimeOption`
 * wire shape). */
export function describe(engineId, row) {
  const chosen = chosenFor(engineId, row);
  return offeredFor(row).map((o) => ({
    key: o.key,
    label: o.label,
    hint: o.hint,
    type: o.type,
    default: o.default,
    value: chosen[o.key],
    choices: o.choices.map(([c, lbl]) => ({ value: c, label: lbl })),
    min: o.min,
    max: o.max,
    integer: o.integer,
    featured: o.featured,
  }));
}
