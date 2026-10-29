// SPDX-License-Identifier: MIT
//
// The Speech tab of AI Settings — the kit's audio.cpp runtime tab (round E, docs/plans/2026-10-29-
// round-e-onto-the-kit.md §4 step 5, G6) — with JustVoice's speech models grouped by engine and
// filtered as the engine list was (decided 2026-10-11, the engine list's slice 4). The kit gives
// each model's row (GET /v1/ai/runtimes/audiocpp/models: its id our model version's, its `fit` the
// kit's fit word); `facts` are ours about it (the engines store's `factsOf` — `{engine, variant}`).

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
