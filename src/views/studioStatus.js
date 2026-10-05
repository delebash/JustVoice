// SPDX-License-Identifier: MIT
//
// Where each Studio step stands — the Overview's "Where it stands" rows and
// its Script tags. Pure, so it is tested without mounting Studio.
//
// HONEST COUNTS ONLY (2026-09-27, decision 2). Every number here comes from
// data the project holds: the chapters' blocks, the cast, each line's render state,
// and each chapter's saved Discover scan (`scene.metadata.discover`, saved
// since the "both" ruling the same day). Nothing records an export, so Export
// shows no count — a number with no data behind it would be invented.

import {
  chapterAnalyzed, isSpeakable, speakersFromImport, unplacedBlocks,
} from "../services/attribution.js";

/**
 * One chapter's blocks → the counts the Overview rolls up.
 * `bySpeaker` is lines per speaker, so "lines blocked on a persona" can be
 * recomputed when Cast changes without refetching every chapter.
 * `scene` carries `metadata.analyzed_at` — the one "analyzed" rule.
 */
export function blockStats(blocks, scene = null) {
  const list = blocks || [];
  const bySpeaker = {};
  let speakable = 0;
  for (const b of list) {
    if (!isSpeakable(b)) continue;
    speakable += 1;
    if (b.speaker_id) bySpeaker[b.speaker_id] = (bySpeaker[b.speaker_id] || 0) + 1;
  }
  return {
    speakable,
    unplaced: unplacedBlocks(list).length,
    analyzed: chapterAnalyzed(scene, list),
    fromImport: speakersFromImport(scene, list),
    bySpeaker,
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
 *   "cast"    a speaker of this book; `speaker` is who
 *   "library" no speaker yet, but a persona in the library has exactly this
 *             name; Add makes the speaker already cast with it (`persona`)
 *   "new"     no speaker, no persona of that name; Add makes the speaker
 *   "ignored" on the project's ignore list; Undo takes it off
 * [{key, status, name, names, speaker, persona, role_hint, evidence,
 *   evidence_found, lines, mentions, chapters}], waiting rows first.
 *
 * A saved scan holds the AI's names that were not speakers (`candidates`,
 * ignored ones included) and the speakers the text names (`named_cast`, found
 * by name without the AI). The status is worked out now, not at scan time, so
 * someone added, removed or ignored since shows as such — Add and Ignore change
 * a row, they never remove it; a removed speaker's row turns New.
 *
 * Merged (Discover fixes A + D, 2026-09-27): everything that points at one
 * speaker is one row; among the rest, a name that is another with words added
 * is one row ("Sedge" + "Old Sedge"), shown under its longest form.
 * `cast` is the book's speakers [{id, name, aliases}] (names alone are accepted
 * too); `ignored` the project's ignore list; `personas` the library.
 */
const STATUS_ORDER = { new: 0, library: 1, cast: 2, ignored: 3 };
export function foundSpeakers(scenes, cast = [], ignored = [], personas = []) {
  const castRows = cast.map((c) => (typeof c === "string" ? { id: null, name: c } : c));
  const castById = new Map(castRows.filter((c) => c.id).map((c) => [c.id, c]));
  const castByName = new Map();
  for (const c of castRows) {
    for (const n of [c.name, ...(c.aliases || [])]) {
      const k = normName(n);
      if (k && !castByName.has(k)) castByName.set(k, c);
    }
  }
  const ignoredNames = new Set((ignored || []).map(normName));
  // A persona of exactly this name — one only: two of the same name match none.
  const personaByName = new Map();
  const twice = new Set();
  for (const p of personas || []) {
    const k = normName(p.name);
    if (!k) continue;
    if (personaByName.has(k)) twice.add(k);
    else personaByName.set(k, p);
  }
  for (const k of twice) personaByName.delete(k);

  const rows = [];
  const speakerRow = (sp) => {
    let row = rows.find((r) => r.speaker?.id === sp.id);
    if (!row) {
      row = blank(`s:${sp.id}`, sp.name);
      row.status = "cast";
      row.speaker = { id: sp.id, name: sp.name };
      rows.push(row);
    }
    return row;
  };
  const nameRow = (status, name) => {
    let row = rows.find((r) => r.status === status && r.names.some((n) => isVariant(n, name)));
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
    if (!row.speaker && clean.length > row.name.length) row.name = clean;
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
  // A name with no speaker behind it: Ignored, In your library, or New.
  const byName = (s, name, c) => {
    const key = normName(name);
    if (!key) return;
    const sp = castByName.get(key);
    if (sp?.id) note(speakerRow(sp), s, name, c);
    else if (ignoredNames.has(key)) note(nameRow("ignored", name), s, name, c);
    else if (personaByName.has(key)) {
      const row = nameRow("library", name);
      row.persona = { id: personaByName.get(key).id, name: personaByName.get(key).name };
      note(row, s, name, c);
    } else note(nameRow("new", name), s, name, c);
  };
  for (const s of scenes || []) {
    const saved = s.metadata?.discover;
    if (!saved) continue;
    for (const m of saved.named_cast || []) {
      const sp = castById.get(m.speaker_id);
      if (sp) note(speakerRow(sp), s, m.name, m);
      else byName(s, m.name, m);   // removed since the scan
    }
    for (const c of saved.candidates || []) byName(s, c.name, c);
  }
  // A new name that is a library row's name with words dropped ("Sedge" beside
  // "Old Sedge" when a persona is called Old Sedge) is that person: one row,
  // and Add keeps the other spelling as "Also called".
  for (const row of rows.filter((r) => r.status === "new")) {
    const lib = rows.find((r) => r.status === "library" && r.names.some((n) => row.names.some((m) => isVariant(n, m))));
    if (!lib) continue;
    for (const n of row.names) if (!lib.names.includes(n)) lib.names.push(n);
    lib.lines += row.lines;
    lib.mentions += row.mentions;
    if (!lib.role_hint) lib.role_hint = row.role_hint;
    if (!lib.evidence && row.evidence) Object.assign(lib, { evidence: row.evidence, evidence_found: row.evidence_found });
    for (const id of row.chapters) if (!lib.chapters.includes(id)) lib.chapters.push(id);
    rows.splice(rows.indexOf(row), 1);
  }
  // Waiting rows first; then most lines, then most mentions; a tie keeps book
  // order (a named speaker often speaks none in the chapters scanned).
  return rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || b.lines - a.lines || b.mentions - a.mentions);
}
function blank(key, name) {
  return {
    key, status: null, name: (name || "").trim(), names: [], speaker: null, persona: null,
    role_hint: "", evidence: "", evidence_found: null, lines: 0, mentions: 0, chapters: [],
  };
}
/** A row still waiting for Add or Ignore. */
export const isWaiting = (r) => r.status === "new" || r.status === "library";

/**
 * Roll the chapters and the cast up into the project's state.
 * `stats` is {sceneId: blockStats}; `cast` is the book's speakers [{id, name,
 * aliases, ready, narrator}] — `ready` = played by a persona that has a voice;
 * `ignored` is the project's Discover ignore list; `personas` the library;
 * `render` is GET /v1/projects/{id}/render_state's `totals` (§8.16's counts:
 * lines, needs_speaker, needs_voice, ready, rendered, stale — Studio Slice 4),
 * or null before it loads;
 * `script` is GET /v1/projects/{id}/script's chapters (the flags are the
 * server's), or null before it loads; `running` counts chapters being analyzed.
 */
export function projectState({
  scenes = [], stats = {}, cast = [], ignored = [], personas = [], render = null, script = null,
  running = 0,
}) {
  let lines = 0;
  let unplaced = 0;
  let analyzed = 0;
  let fromImport = 0;
  const bySpeaker = {};
  for (const s of scenes) {
    const st = stats[s.id];
    if (!st) continue;
    lines += st.speakable;
    unplaced += st.unplaced;
    if (st.analyzed) analyzed += 1;
    if (st.fromImport) fromImport += 1;
    for (const [sid, n] of Object.entries(st.bySpeaker)) bySpeaker[sid] = (bySpeaker[sid] || 0) + n;
  }
  const flagged = (script || []).reduce((n, c) => n + (c.flagged || 0), 0);
  // Lines with no speaker in what Analyze (or the import) decided — the
  // grid's "To check". A chapter never analyzed needs Analyze instead.
  const noSpeaker = script
    ? script.filter((c) => c.analyzed || c.from_import).reduce((n, c) => n + (c.no_speaker || 0), 0)
    : unplaced;
  const notReady = cast.filter((sp) => !sp.ready);
  const scanned = scenes.filter((s) => s.metadata?.discover?.scanned_at).length;
  // Found names still waiting for Add or Ignore.
  const proposed = foundSpeakers(scenes, cast, ignored, personas).filter(isWaiting).length;
  // Lines of speakers no persona-with-a-voice plays — the render stops on them.
  const blocked = notReady.reduce((sum, sp) => sum + (bySpeaker[sp.id] || 0), 0);
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
    castReady: cast.length - notReady.length,
    speakersBesideNarrator: cast.filter((sp) => !sp.narrator).length,
    blocked,
    // Lines with a take (a stale one still plays), of the lines that can render.
    rendered: render ? render.rendered + render.stale : null,
    renderable: render ? render.ready + render.rendered + render.stale : null,
    stale: render ? render.stale : 0,
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
          ? `${state.castReady.toLocaleString()} of ${plural(state.castTotal, "speaker")} cast`
          : "No speakers yet",
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
          : state.stale
            ? { intent: "accent2", label: `${state.stale.toLocaleString()} stale` }
            : null,
      };
    case "export":
      return { text: "M4B · WAVs · ACX check", tag: null };
    default:
      return { text: "", tag: null };
  }
}

