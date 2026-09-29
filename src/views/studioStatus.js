// SPDX-License-Identifier: MIT
//
// Where each Studio step stands — the Overview's "Where it stands" rows and
// its Script tags. Pure, so it is tested without mounting Studio.
//
// HONEST COUNTS ONLY (2026-09-27, decision 2). Every number here comes from
// data the project holds: the chapters' blocks, the cast, the render cache,
// and each chapter's saved Discover scan (`scene.metadata.discover`, saved
// since the "both" ruling the same day). Nothing records an export, so Export
// shows no count — a number with no data behind it would be invented.

import {
  chapterAnalyzed, isSpeakable, speakersFromImport, unplacedBlocks,
} from "../services/attribution.js";

/**
 * One chapter's blocks → the counts the Overview rolls up.
 * `byPersona` is spoken lines per persona, so "lines blocked on a voice" can be
 * recomputed when a voice is assigned without refetching every chapter.
 * `scene` carries `metadata.analyzed_at` — the one "analyzed" rule.
 */
export function blockStats(blocks, scene = null) {
  const list = blocks || [];
  const byPersona = {};
  let speakable = 0;
  for (const b of list) {
    if (!isSpeakable(b)) continue;
    speakable += 1;
    if (b.persona_id) byPersona[b.persona_id] = (byPersona[b.persona_id] || 0) + 1;
  }
  return {
    speakable,
    unplaced: unplacedBlocks(list).length,
    analyzed: chapterAnalyzed(scene, list),
    fromImport: speakersFromImport(scene, list),
    byPersona,
  };
}

// Name comparison, the same rules as the server's extraction/names.py.
const normName = (n) => (n || "").normalize("NFKC").replace(/’/g, "'").toLowerCase()
  .replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();

/** One name is the other with whole words added ("Sedge" / "Old Sedge"). */
export function isVariant(a, b) {
  const x = normName(a).split(" ").filter(Boolean);
  const y = normName(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  for (let i = 0; i + short.length <= long.length; i += 1) {
    if (short.every((w, j) => long[i + j] === w)) return true;
  }
  return false;
}

/**
 * Everyone a project's saved scans found, merged across chapters, each person
 * once with a status — Discover's record (decided 2026-09-29):
 *   "cast"    in this cast; `persona` is who
 *   "library" a persona in your library but not this cast; Add links it
 *   "new"     a name no persona has; Add makes one
 *   "ignored" on the project's ignore list; Undo takes it off
 * [{key, status, name, names, persona, role_hint, evidence, evidence_found,
 *   lines, mentions, chapters}], waiting rows first.
 *
 * A saved scan holds the AI's names that were not cast (`candidates`, ignored
 * ones included) and the cast members the text names (`named_cast`, found by
 * name without the AI). The status is worked out now, not at scan time, so
 * someone added or ignored since shows as such — Add and Ignore change a row,
 * they never remove it.
 *
 * Merged (Discover fixes A + D, 2026-09-27): everything that points at one
 * persona is one row ("Brick", "Brick Halvorn" → Brick Halvorn); among the
 * rest, a name that is another with words added is one row ("Sedge" + "Old
 * Sedge"), shown under its longest form.
 * `cast` is [{id, name, aliases}] (names alone are accepted too); `ignored` is
 * the project's ignore list.
 */
const STATUS_ORDER = { new: 0, library: 1, cast: 2, ignored: 3 };
export function foundSpeakers(scenes, cast = [], ignored = []) {
  const castRows = cast.map((c) => (typeof c === "string" ? { id: null, name: c } : c));
  const castIds = new Set(castRows.map((c) => c.id).filter(Boolean));
  const castByName = new Map();
  for (const c of castRows) {
    for (const n of [c.name, ...(c.aliases || [])]) {
      const k = normName(n);
      if (k && !castByName.has(k)) castByName.set(k, c);
    }
  }
  const ignoredNames = new Set((ignored || []).map(normName));
  const rows = [];
  const personaRow = (id, name) => {
    let row = rows.find((r) => r.persona?.id === id);
    if (!row) {
      row = blank(`p:${id}`, name);
      row.persona = { id, name };
      rows.push(row);
    }
    return row;
  };
  const nameRow = (status, name) => {
    let row = rows.find((r) => r.status === status && !r.persona && r.names.some((n) => isVariant(n, name)));
    if (!row) {
      row = blank(`${status}:${normName(name)}`, name);
      row.status = status;
      rows.push(row);
    }
    return row;
  };
  const note = (row, s, name, c) => {
    const clean = (name || "").trim();
    if (clean && !row.names.includes(clean)) row.names.push(clean);
    if (!row.persona && clean.length > row.name.length) row.name = clean;
    row.lines += c.approx_lines || 0;
    row.mentions += c.mentions || 0;
    if (!row.role_hint && c.role_hint) row.role_hint = c.role_hint;
    // The first chapter's quote that names them — "first appearance".
    if (!row.evidence && c.evidence) {
      row.evidence = c.evidence;
      row.evidence_found = c.evidence_found ?? null;
    }
    if (!row.chapters.includes(s.id)) row.chapters.push(s.id);
  };
  for (const s of scenes || []) {
    const saved = s.metadata?.discover;
    if (!saved) continue;
    for (const m of saved.named_cast || []) {
      const now = castRows.find((c) => c.id === m.persona_id);
      note(personaRow(m.persona_id, now?.name || m.name), s, m.name, m);
    }
    for (const c of saved.candidates || []) {
      const key = normName(c.name);
      if (!key) continue;
      const lib = c.library_match || null;
      const inCast = lib && castIds.has(lib.persona_id)
        ? castRows.find((r) => r.id === lib.persona_id)
        : castByName.get(key);
      if (inCast?.id) note(personaRow(inCast.id, inCast.name), s, c.name, c);
      else if (ignoredNames.has(key)) note(nameRow("ignored", c.name), s, c.name, c);
      else if (lib) note(personaRow(lib.persona_id, lib.name), s, c.name, c);
      else note(nameRow("new", c.name), s, c.name, c);
    }
  }
  for (const r of rows) {
    if (r.persona) r.status = castIds.has(r.persona.id) ? "cast" : "library";
  }
  // Waiting rows first; then most lines, then most mentions; a tie keeps book
  // order (a named character often speaks none in the chapters scanned).
  return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || b.lines - a.lines || b.mentions - a.mentions);
}
function blank(key, name) {
  return {
    key, status: null, name: (name || "").trim(), names: [], persona: null, role_hint: "",
    evidence: "", evidence_found: null, lines: 0, mentions: 0, chapters: [],
  };
}
/** A row still waiting for Add or Ignore. */
export const isWaiting = (r) => r.status === "new" || r.status === "library";

/**
 * Roll the chapters and the cast up into the project's state.
 * `stats` is {sceneId: blockStats}; `cast` is [{id, name, aliases, voice_id,
 * narrator}]; `ignored` is the project's Discover ignore list;
 * `cache` is the /v1/render/cache-stats body, or null before it loads;
 * `script` is GET /v1/projects/{id}/script's chapters (the flags are the
 * server's), or null before it loads; `running` counts chapters being analyzed.
 */
export function projectState({
  scenes = [], stats = {}, cast = [], ignored = [], cache = null, script = null, running = 0,
}) {
  let lines = 0;
  let unplaced = 0;
  let analyzed = 0;
  let fromImport = 0;
  const byPersona = {};
  for (const s of scenes) {
    const st = stats[s.id];
    if (!st) continue;
    lines += st.speakable;
    unplaced += st.unplaced;
    if (st.analyzed) analyzed += 1;
    if (st.fromImport) fromImport += 1;
    for (const [pid, n] of Object.entries(st.byPersona)) byPersona[pid] = (byPersona[pid] || 0) + n;
  }
  const flagged = (script || []).reduce((n, c) => n + (c.flagged || 0), 0);
  // Lines with no speaker in what Analyze (or the import) decided — the
  // grid's "To check". A chapter never analyzed needs Analyze instead.
  const noSpeaker = script
    ? script.filter((c) => c.analyzed || c.from_import).reduce((n, c) => n + (c.no_speaker || 0), 0)
    : unplaced;
  const voiceless = cast.filter((p) => !p.voice_id);
  const scanned = scenes.filter((s) => s.metadata?.discover?.scanned_at).length;
  // Found names still waiting for Add or Ignore.
  const proposed = foundSpeakers(scenes, cast, ignored).filter(isWaiting).length;
  const blocked = voiceless.reduce((sum, p) => sum + (byPersona[p.id] || 0), 0);
  return {
    chapters: scenes.length,
    scanned,
    proposed,
    analyzed,
    fromImport,
    running,
    flagged,
    noSpeaker,
    lines,
    unplaced,
    castTotal: cast.length,
    castVoiced: cast.length - voiceless.length,
    speakersBesideNarrator: cast.filter((p) => !p.narrator).length,
    blocked,
    rendered: cache ? cache.cached : null,
    renderable: cache ? cache.total : null,
  };
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * The row for one step: what it says, and the tag (if any) naming the thing
 * in the way. `unit` is the kind's word for a chapter ({singular, plural}).
 * Script's row can carry two (`tags`), each opening Script's grid on "To
 * check" (`go`).
 */
export function stepStatus(key, state, unit) {
  const ch = (n) => `${n.toLocaleString()} ${(n === 1 ? unit.singular : unit.plural).toLowerCase()}`;
  switch (key) {
    case "discover":
      return {
        text: state.chapters
          ? `${state.scanned.toLocaleString()} of ${ch(state.chapters)} scanned`
          : `No ${unit.plural.toLowerCase()} yet`,
        tag: state.proposed
          ? { intent: "accent2", label: `${plural(state.proposed, "speaker")} to review` }
          : null,
      };
    case "script": {
      if (!state.chapters) return { text: `No ${unit.plural.toLowerCase()} yet`, tag: null, tags: [] };
      const toCheck = { go: ["script", "check"], title: `Opens Script on the ${unit.plural.toLowerCase()} to check` };
      const tags = [
        ...(state.noSpeaker ? [{ intent: "danger", label: `${state.noSpeaker.toLocaleString()} no speaker`, ...toCheck }] : []),
        ...(state.flagged ? [{ intent: "danger", label: `${state.flagged.toLocaleString()} flagged`, ...toCheck }] : []),
      ];
      // Every chapter's speakers came with the import (a podcast's scripts):
      // there was nothing to analyze, and "0 of 12 analyzed" would say otherwise.
      const imported = !state.analyzed && state.fromImport > 0 && state.fromImport === state.chapters;
      return {
        text: imported
          ? `${state.fromImport.toLocaleString()} of ${ch(state.chapters)} have speakers · from the import`
          : `${state.analyzed.toLocaleString()} of ${ch(state.chapters)} analyzed${state.running ? ` · ${state.running} running` : ""}`,
        tag: tags[0] || null,
        tags,
      };
    }
    case "lines":
      return {
        text: state.lines ? plural(state.lines, "line") : "No lines yet — re-import the sheet",
        tag: null,
      };
    case "cast":
      return {
        text: state.castTotal
          ? `${state.castVoiced.toLocaleString()} of ${plural(state.castTotal, "persona")} voiced`
          : "No cast yet",
        tag: state.blocked ? { intent: "danger", label: `${plural(state.blocked, "line")} blocked` } : null,
      };
    case "render":
      if (state.renderable === null) return { text: "Checking what is rendered…", tag: null };
      return {
        text: state.renderable
          ? `${state.rendered.toLocaleString()} of ${plural(state.renderable, "line")} rendered`
          : "Nothing can render yet",
        tag: state.renderable && state.rendered < state.renderable
          ? { intent: "accent2", label: `${(state.renderable - state.rendered).toLocaleString()} to go` }
          : null,
      };
    case "export":
      return { text: "M4B · WAVs · ACX check", tag: null };
    default:
      return { text: "", tag: null };
  }
}

