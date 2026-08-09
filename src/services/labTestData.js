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

async function listProjects() {
  const r = await api().request("/v1/projects");
  return r?.projects || [];
}

async function castOf(projectId) {
  const [cast, personas] = await Promise.all([
    api().request(`/v1/projects/${projectId}/cast`),
    api().request("/v1/personas"),
  ]);
  const byId = Object.fromEntries((personas?.personas || []).map((p) => [p.id, p]));
  const rows = (cast?.cast || []).map((c) => byId[c.persona_id]).filter(Boolean);
  if (!rows.length) throw new Error("That project has no cast yet.");
  return rows;
}

async function allVoices() {
  const r = await api().request("/v1/voices");
  const rows = r?.voices || [];
  if (!rows.length) throw new Error("No voices yet — fetch voices first.");
  return rows;
}

async function allPersonas() {
  const r = await api().request("/v1/personas");
  return r?.personas || [];
}

// ── production-format mirrors (source of truth named per block) ────────────

// Attribution / identify cast lines — the adapter's own parse shape
// (attributionLab.js parseCharacters · CastEditor serialization): one name
// per line. Exported (with the blocks below) for the Part 6 contract tests.
export function castNamesBlock(rows) {
  return rows.map((p) => p.name).filter(Boolean).join("\n");
}

// smart_assign {{characters}} — mirrors smart_assign_api._format_characters
// over the fields StudioView's production call sends (id · name · bio ·
// personality).
export function smartAssignCharactersBlock(rows) {
  return rows
    .map((p) => {
      const bits = [`id="${p.id}"`, `name="${p.name}"`];
      const desc = p.bio || p.personality;
      if (desc) bits.push(`description="${String(desc).slice(0, 200)}"`);
      return `- ${bits.join(", ")}`;
    })
    .join("\n");
}

// smart_assign {{voices}} — mirrors smart_assign_api._format_voices over the
// fields StudioView's production call sends (id · name · gender · language).
export function smartAssignVoicesBlock(rows) {
  return rows
    .map((v) => {
      const bits = [`id="${v.id}"`, `name="${v.name || v.id}"`];
      if (v.gender) bits.push(`gender="${v.gender}"`);
      if (v.language) bits.push(`language="${v.language}"`);
      return `- ${bits.join(", ")}`;
    })
    .join("\n");
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
  const [scenes, personas] = await Promise.all([
    api().request(`/v1/projects/${projectId}/scenes`),
    api().request("/v1/personas"),
  ]);
  const nameById = Object.fromEntries((personas?.personas || []).map((p) => [p.id, p.name]));
  const parts = [];
  for (const scene of scenes || []) {
    parts.push(`## ${scene.title || "Segment"}`);
    const blocks = await api().request(`/v1/scenes/${scene.id}/blocks`);
    for (const b of blocks || []) {
      parts.push(`${(b.persona_id && nameById[b.persona_id]) || "NARRATION"}: ${b.text}`);
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
      return (await listProjects()).map((p) => ({ id: p.id, label: `Cast of ${p.name}` }));
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
  { source: "cast", fill: async (id) => ({ characters: castNamesBlock(await castOf(id)) }) },
];

export const LAB_TEST_ACTIONS = {
  "speaker_attribution.guided": { pickers: ATTR_PICKERS },
  "speaker_attribution.direct": { pickers: ATTR_PICKERS },
  "speaker_attribution.identify": {
    pickers: [
      { source: "chapters", fill: async (id) => ({ manuscript: await chapterProse(id) }) },
      { source: "cast", fill: async (id) => ({ known_characters: castNamesBlock(await castOf(id)) }) },
    ],
  },
  smart_assign: {
    pickers: [
      { source: "cast", fill: async (id) => ({ characters: smartAssignCharactersBlock(await castOf(id)) }) },
      { source: "voices", fill: async () => ({ voices: smartAssignVoicesBlock(await allVoices()) }) },
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
          if (!p?.personality?.trim()) throw new Error("That persona has no personality text yet.");
          return { personality: p.personality.trim() };
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
          if (!p?.personality?.trim()) throw new Error("That persona has no personality text yet.");
          return { personality: p.personality.trim() };
        },
      },
    ],
  },
};
