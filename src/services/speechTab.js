// SPDX-License-Identifier: MIT
//
// The Speech tab of AI Settings — the kit's audio.cpp runtime tab (round E, docs/plans/2026-10-29-
// round-e-onto-the-kit.md §4 step 5, G6) — with JustVoice's speech models grouped by engine,
// filtered and sorted as the engine list was (decided 2026-10-11, the engine list's slice 4). The kit gives
// each model's row (GET /v1/ai/runtimes/audiocpp/models: its id our model version's, its `fit` the
// kit's fit word); `facts` are ours about it (the engines store's `factsOf` — `{engine, variant}`).

import { COMMERCIAL_USE } from "./engineFacts.js";

/** The model's group: its engine, by the engine's name — null for a model no engine of ours lists. */
export function groupOf(_model, facts) {
  return facts ? { key: facts.engine.id, label: facts.engine.name || facts.engine.id } : null;
}

const directed = (v) => v?.directed_by === "words" || v?.directed_by === "tags";

/**
 * Whether the tab lists `model` under `filters` (the object the tab's filters edit): Cloning and
 * Built-in voices ask the model, Commercial use and Tested by JustVoice its engine, Takes
 * direction how it is directed, Fits this card the kit's fit word. An engine marked for removal is
 * hidden while the speech runtime isn't installed — nobody new should pick it up (2026-08-17).
 */
export function modelShown(model, filters, facts) {
  const e = facts?.engine;
  const v = facts?.variant;
  if ((e?.deprecated || "").trim() && e.status === "not_installed") return false;
  if (filters.cloning && v?.voice_cloning !== true) return false;
  if (filters.presets && !((v?.preset_voices || 0) > 0)) return false;
  if (filters.commercial && filters.commercial !== "all" && e?.licence?.commercial !== filters.commercial) return false;
  if (filters.tested && !e?.tested) return false;
  if (filters.directed && !directed(v)) return false;
  if (filters.fits && model.fit !== "ok") return false;
  return true;
}

// ── The sort (the engine list's, decided 2026-10-11 — engineFacts.js SORTS, the filters' `sort`) ──
// The kit tab's `groupSort` and `sort` (AiPage.vue): the engines by name, by their smallest model's
// download or memory needed, or by commercial use — each then by name; inside an engine, its models
// by their own download or memory, else in the server's order, as the engine list kept them. A
// download is the kit row's `bytes`; the memory needed our facts' `need_gb` (audio.cpp's estimate or
// the download, whichever is more), unknown last.

const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
const downloadOf = (m) => Number(m.bytes) || Number.POSITIVE_INFINITY;
const memoryOf = (m, factsOf) => Number(factsOf(m.id)?.variant?.need_gb) || Number.POSITIVE_INFINITY;
const smallest = (models, of) => (models.length ? Math.min(...models.map(of)) : Number.POSITIVE_INFINITY);
const commercialRank = (g, factsOf) => COMMERCIAL_USE.indexOf(factsOf(g.models[0]?.id)?.engine?.licence?.commercial ?? "Unclear");

/** Two of the tab's groups (`{key, label, models}`, its every model) in the order `by` picks. */
export function groupOrder(a, b, by, factsOf) {
  let order = 0;
  if (by === "size") order = cmp(smallest(a.models, downloadOf), smallest(b.models, downloadOf));
  else if (by === "memory") order = cmp(smallest(a.models, (m) => memoryOf(m, factsOf)), smallest(b.models, (m) => memoryOf(m, factsOf)));
  else if (by === "commercial") order = commercialRank(a, factsOf) - commercialRank(b, factsOf);
  return order || (a.label || a.key).localeCompare(b.label || b.key);
}

/** Two of the tab's models in the order `by` picks — 0 keeps the server's. */
export function modelOrder(a, b, by, factsOf) {
  if (by === "size") return cmp(downloadOf(a), downloadOf(b));
  if (by === "memory") return cmp(memoryOf(a, factsOf), memoryOf(b, factsOf));
  return 0;
}
