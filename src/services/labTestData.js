// SPDX-License-Identifier: MIT
// The Lab test-data registry (§7.3 — the kit's configureTestData seam, off by
// default; JW's labTestData.js is the donor shape). Part 4 of the Lab plan
// (2026-08-06): "boxes stop faking data the app already owns" — JV registers
// its listable app material and one declaration per seeded action. Every fill
// emits the SAME formatted block the production caller sends; the server
// source of truth is named per fill so the mirror can't drift silently
// (Part 6's JS tests pin the shapes).
import { proseFromBlocks } from "./attribution.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useApi } from "../stores/api.js";
import { usePersonasStore } from "../stores/personas.js";
import { useProjectsStore } from "../stores/projects.js";
import { useVoicesStore } from "../stores/voices.js";

function api() {
  return useApi();
}

// ── raw app reads ──────────────────────────────────────────────────────────

async function listChapters() {
  const pid = useActiveProject().id;
  if (!pid) return [];
  const rows = await api().request(`/v1/projects/${pid}/scenes`);
  return (rows || []).map((s, i) => ({ id: s.id, label: s.title || `Chapter ${i + 1}` }));
}

// A chapter's prose = its blocks' text in order (the same rows Studio's
// Script tab shows; import creates them from the manuscript). The join is
// the shared one Studio feeds Analyze with — it was written twice.
async function chapterProse(sceneId) {
  const text = proseFromBlocks(await api().request(`/v1/scenes/${sceneId}/blocks`));
  if (!text) throw new Error("This chapter has no text yet.");
  return text;
}

// Projects, personas and voices are SHARED state: they come from their stores,
// which every writer in the app reloads. Fetching them here was a private second
// copy — the Lab's picker went on listing yesterday's projects (2026-08-15). A
// book's speakers have no store and stay a direct read.
async function listProjects() {
  const store = useProjectsStore();
  await store.ensureLoaded();
  return store.items;
}

// A book's speakers (2026-09-29) — id · name · aliases · description.
async function castOf(projectId) {
  const r = await api().request(`/v1/projects/${projectId}/speakers`);
  const rows = r?.speakers || [];
  if (!rows.length) throw new Error("That project has no speakers yet.");
  return rows;
}

async function allVoices() {
  const store = useVoicesStore();
  await store.ensureLoaded();
  const rows = store.items;
  if (!rows.length) throw new Error("No voices yet — fetch voices first.");
  return rows;
}

async function allPersonas() {
  const store = usePersonasStore();
  await store.ensureLoaded();
  return store.items;
}

// ── production-format mirrors (source of truth named per block) ────────────

// Attribution / identify cast lines — the adapter's own parse shape
// (attributionLab.js parseCharacters · CastEditor serialization): one name
// per line. Exported (with the blocks below) for the Part 6 contract tests.
export function castNamesBlock(rows) {
  return rows.map((p) => p.name).filter(Boolean).join("\n");
}

// smart_assign {{speakers}} — mirrors smart_assign_api._format_characters
// over the fields Studio · Cast's production call sends: the book's speakers
// (id · name · aliases · description — "who they are").
export function smartAssignCharactersBlock(rows) {
  return rows
    .map((sp) => {
      const bits = [`id="${sp.id}"`, `name="${sp.name}"`];
      if (sp.aliases?.length) bits.push(`aliases="${sp.aliases.join(", ")}"`);
      if (sp.description) bits.push(`description="${String(sp.description).slice(0, 200)}"`);
      return `- ${bits.join(", ")}`;
    })
    .join("\n");
}

// smart_assign {{personas}} — mirrors smart_assign_api._format_voices over the
// fields Studio · Cast's production call sends: the personas (id · name · its
// voice's gender · tone = the note on how it sounds · language), 2026-09-29.
export function smartAssignVoicesBlock(rows) {
  return rows
    .map((v) => {
      const bits = [`id="${v.id}"`, `name="${v.name || v.id}"`];
      if (v.gender) bits.push(`gender="${v.gender}"`);
      if (v.tone) bits.push(`tone="${v.tone}"`);
      if (v.language) bits.push(`language="${v.language}"`);
      return `- ${bits.join(", ")}`;
    })
    .join("\n");
}
// The personas as Cast sends them to Smart-assign.
async function personasAsVoices() {
  const [personas, voices] = await Promise.all([allPersonas(), allVoices().catch(() => [])]);
  if (!personas.length) throw new Error("No personas yet — make one on the Personas page.");
  const voiceById = Object.fromEntries(voices.map((v) => [v.id, v]));
  return personas.map((p) => ({
    id: p.id, name: p.name, gender: voiceById[p.voice_id]?.gender || null,
    language: p.language || null, tone: p.note || null,
  }));
}

// voice_gender {{voices}} — mirrors voices_api's lines ("- Name — description")
// over what VoicesView's ✨ button sends (name · design_prompt).
export function voiceGenderBlock(rows) {
  return rows
    .map((v) => `- ${v.name || v.id}${v.design_prompt ? ` — ${v.design_prompt}` : ""}`)
    .join("\n");
}

// render_preset_suggest {{presets}} — mirrors preset_suggest_api's list
// ("  - Name — description").
async function presetsBlock() {
  const r = await api().request("/v1/presets");
  const rows = r?.presets || [];
  if (!rows.length) throw new Error("No render presets yet — create some on the Render Presets tab.");
  return rows
    .map((p) => `  - ${p.name}${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");
}

// show_notes {{script}} — mirrors projects_api's show-notes builder
// ("## Title" + "WHO: text" per block, NARRATION when unassigned).
async function scriptOf(projectId) {
  const [scenes, speakers] = await Promise.all([
    api().request(`/v1/projects/${projectId}/scenes`),
    api().request(`/v1/projects/${projectId}/speakers`),
  ]);
  const nameById = Object.fromEntries((speakers?.speakers || []).map((sp) => [sp.id, sp.name]));
  const parts = [];
  for (const scene of scenes || []) {
    parts.push(`## ${scene.title || "Segment"}`);
    const blocks = await api().request(`/v1/scenes/${scene.id}/blocks`);
    for (const b of blocks || []) {
      parts.push(`${(b.speaker_id && nameById[b.speaker_id]) || "NARRATION"}: ${b.text}`);
    }
  }
  const script = parts.join("\n").slice(0, 24000);
  if (!script.trim()) throw new Error("That project has no segments yet.");
  return script;
}

// ── the listable sources ───────────────────────────────────────────────────

export const LAB_TEST_SOURCES = [
  {
    id: "chapters",
    label: "chapter",
    kind: "chapter",
    list: listChapters,
  },
  {
    id: "cast",
    label: "cast",
    kind: "cast",
    async list() {
      return (await listProjects()).map((p) => ({ id: p.id, label: `Speakers of ${p.name}` }));
    },
  },
  {
    id: "library",
    label: "personas",
    kind: "personas",
    async list() {
      const n = (await allPersonas().catch(() => [])).length;
      return n ? [{ id: "all", label: `All personas (${n})` }] : [];
    },
  },
  {
    id: "voices",
    label: "voices",
    kind: "voices",
    async list() {
      const rows = (await allVoices().catch(() => []));
      return rows.length ? [{ id: "all", label: `All voices (${rows.length})` }] : [];
    },
  },
  {
    id: "personas",
    label: "persona",
    kind: "persona",
    async list() {
      return (await allPersonas()).map((p) => ({ id: p.id, label: p.name || "Unnamed" }));
    },
  },
  {
    id: "presets",
    label: "render presets",
    kind: "presets",
    async list() {
      const r = await api().request("/v1/presets").catch(() => null);
      const n = (r?.presets || []).length;
      return n ? [{ id: "all", label: `All render presets (${n})` }] : [];
    },
  },
  {
    id: "script",
    label: "script",
    kind: "script",
    async list() {
      return (await listProjects()).map((p) => ({ id: p.id, label: `Script of ${p.name}` }));
    },
  },
];

// ── per-action declarations ────────────────────────────────────────────────

const ATTR_PICKERS = [
  { source: "chapters", fill: async (id) => ({ paragraphs: await chapterProse(id) }) },
  { source: "cast", fill: async (id) => ({ speakers: castNamesBlock(await castOf(id)) }) },
];

export const LAB_TEST_ACTIONS = {
  "speaker_attribution.guided": { pickers: ATTR_PICKERS },
  "speaker_attribution.direct": { pickers: ATTR_PICKERS },
  "speaker_attribution.identify": {
    pickers: [
      { source: "chapters", fill: async (id) => ({ manuscript: await chapterProse(id) }) },
      { source: "cast", fill: async (id) => ({ known_speakers: castNamesBlock(await castOf(id)) }) },
    ],
  },
  smart_assign: {
    pickers: [
      { source: "cast", fill: async (id) => ({ speakers: smartAssignCharactersBlock(await castOf(id)) }) },
      { source: "library", fill: async () => ({ personas: smartAssignVoicesBlock(await personasAsVoices()) }) },
    ],
  },
  voice_gender: {
    pickers: [
      { source: "voices", fill: async () => ({ voices: voiceGenderBlock(await allVoices()) }) },
    ],
  },
  render_preset_suggest: {
    pickers: [
      { source: "presets", fill: async () => ({ presets: await presetsBlock() }) },
      { source: "chapters", fill: async (id) => ({ chapter_text: await chapterProse(id) }) },
    ],
  },
  show_notes: {
    pickers: [{ source: "script", fill: async (id) => ({ script: await scriptOf(id) }) }],
  },
  compose: {
    pickers: [
      {
        source: "personas",
        fill: async (id) => {
          const p = (await allPersonas()).find((x) => x.id === id);
          // Compose / Rewrite read the persona's note on how it sounds
          // (2026-09-29); the template variable keeps its name.
          if (!p?.note?.trim()) throw new Error("That persona has no note on how it sounds yet.");
          return { personality: p.note.trim() };
        },
      },
    ],
  },
  persona_rewrite: {
    pickers: [
      {
        source: "personas",
        fill: async (id) => {
          const p = (await allPersonas()).find((x) => x.id === id);
          // Compose / Rewrite read the persona's note on how it sounds
          // (2026-09-29); the template variable keeps its name.
          if (!p?.note?.trim()) throw new Error("That persona has no note on how it sounds yet.");
          return { personality: p.note.trim() };
        },
      },
    ],
  },
};
