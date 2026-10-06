// SPDX-License-Identifier: MIT
//
// What the three voice makers in the persona mock share: which models can
// clone or design, how each model's option reads, and the one line that says
// what a voice on that model keeps. The facts are plan
// `2026-10-03-persona-redesign.md` §2.3 ("What each engine and model accepts");
// the model rows are the server's own (`personaMock.js`).

import { DIRECTION_OPTIONS } from "../services/personaFacts.js";
import { languageName } from "@delebash/llm-ui";
import { capabilities, directedByOf, modelLanguages, statusOf } from "./personaMock.js";

// An engine's own row is left out where its families have rows of their own
// (`capabilities.js` capableRows does the same): "Chatterbox" goes, "Chatterbox
// Turbo" stays.
function isFamilyRow(id) {
  return !Object.keys(capabilities).some((other) => other.startsWith(`${id}-`));
}

export function rowsThatCan(field) {
  return Object.entries(capabilities)
    .filter(([id, r]) => r[field] && isFamilyRow(id))
    .map(([id, r]) => ({ id, row: r }));
}

export const engineOf = (model) => model.split("-")[0];

const STATUS_SUFFIX = { loaded: " · loaded", "not installed": " (not installed)", "not loaded": " (not loaded)" };

function languagesText(model) {
  const list = modelLanguages[model] || [];
  if (list.length === 1) return languageName(list[0]) || list[0];
  return `${list.length} languages`;
}

/** A model option: "Chatterbox Turbo (not loaded)", with what it takes as its hint. */
export function modelOptions(field) {
  return rowsThatCan(field)
    .map(({ id, row }) => ({
      value: id,
      label: `${row.display_name}${STATUS_SUFFIX[statusOf(id)] || ""}`,
      hint: `${DIRECTION_OPTIONS.find((o) => o.value === directedByOf(id))?.label} · ${languagesText(id)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Only the models whose voices can be directed this way ("" = any). */
export function forDirection(options, direction) {
  return direction ? options.filter((o) => directedByOf(o.value) === direction) : options;
}

/** The first model of `order` the list offers — a maker's starting pick. */
export function preferred(options, order) {
  return order.find((id) => options.some((o) => o.value === id)) || options[0]?.value || "";
}

/** What a voice made on this model keeps — said where the model is picked. */
export const MODEL_NOTE = {
  "chatterbox-turbo": "Tags only — [fear] [sigh], no written direction. English only; the clip must be longer than 5 seconds.",
  "chatterbox-nano": "Tags only — [fear] [sigh], no written direction. English only; the clip must be longer than 5 seconds. Smaller and faster than Turbo.",
  "chatterbox-multilingual": "Sliders only — pace, pitch and gain. 23 languages.",
  "qwen3-base": "Sliders only — the clip is the whole voice, so written direction is dropped. 10 languages.",
  voxcpm2: "Takes written direction, on a clone too. 30 languages.",
  pocket: "Sliders only. One model per language — English, German, Italian, Portuguese or Spanish.",
  "qwen3-vd": "Each line is spoken from the description, so the voice can shift a little from line to line. 10 languages.",
};

/** The languages a model speaks, as options, by name. */
export function languageOptionsFor(model) {
  return (modelLanguages[model] || []).map((c) => ({ value: c, label: languageName(c) || c }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function fmtLength(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
