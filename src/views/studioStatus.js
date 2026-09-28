// SPDX-License-Identifier: MIT
//
// Where each Studio step stands — the Overview's "Where it stands" rows and
// its Continue button. Pure, so it is tested without mounting Studio.
//
// HONEST COUNTS ONLY (2026-09-27, decision 2). Every number here comes from
// data the project holds: the chapters' blocks, the cast, the render cache,
// and each chapter's saved Discover scan (`scene.metadata.discover`, saved
// since the "both" ruling the same day). Nothing records an export, so Export
// shows no count — a number with no data behind it would be invented.

import { hasSpeakerInfo, isSpeakable, unplacedBlocks } from "../services/attribution.js";

/**
 * One chapter's blocks → the counts the Overview rolls up.
 * `byPersona` is spoken lines per persona, so "lines blocked on a voice" can be
 * recomputed when a voice is assigned without refetching every chapter.
 */
export function blockStats(blocks) {
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
    analyzed: list.some(hasSpeakerInfo),
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
 * The names a project's saved scans still propose, merged across chapters:
 * [{key, name, names, role_hint, evidence, evidence_found, lines, chapters,
 *   library}] — most lines first.
 *
 * Merged (Discover fixes A + D, 2026-09-27): every proposal the server matched
 * to the same library persona is ONE row ("Brick", "Brick Halvorn" → Brick
 * Halvorn); among the rest, a name that is another with words added is ONE row
 * ("Sedge" + "Old Sedge"), shown under its longest form.
 *
 * Dropped: a name already in the cast (it may have been added since the scan),
 * and a library match whose persona has since joined the cast.
 * `cast` is [{id, name}] (names alone are accepted too).
 */
export function proposedSpeakers(scenes, cast = []) {
  const castRows = cast.map((c) => (typeof c === "string" ? { id: null, name: c } : c));
  const castNames = new Set(castRows.map((c) => normName(c.name)));
  const castIds = new Set(castRows.map((c) => c.id).filter(Boolean));
  const rows = [];
  const add = (row, s, c) => {
    row.lines += c.approx_lines || 0;
    if (!row.names.includes(c.name.trim())) row.names.push(c.name.trim());
    if (c.name.trim().length > row.name.length && !row.library) row.name = c.name.trim();
    if (!row.role_hint && c.role_hint) row.role_hint = c.role_hint;
    // The first chapter's quote that names them — "first appearance".
    if (!row.evidence && c.evidence) {
      row.evidence = c.evidence;
      row.evidence_found = c.evidence_found ?? null;
    }
    if (!row.chapters.includes(s.id)) row.chapters.push(s.id);
  };
  for (const s of scenes || []) {
    for (const c of s.metadata?.discover?.candidates || []) {
      const key = normName(c.name);
      if (!key || castNames.has(key)) continue;
      const lib = c.library_match || null;
      if (lib && castIds.has(lib.persona_id)) continue;
      const row = lib
        ? rows.find((r) => r.library?.persona_id === lib.persona_id)
        : rows.find((r) => !r.library && r.names.some((n) => isVariant(n, c.name)));
      if (row) {
        add(row, s, c);
      } else {
        const fresh = {
          key: lib ? `lib:${lib.persona_id}` : key, name: c.name.trim(), names: [],
          role_hint: "", evidence: "", evidence_found: null, lines: 0, chapters: [], library: lib,
        };
        add(fresh, s, c);
        rows.push(fresh);
      }
    }
  }
  // Most lines first; a tie (common — a named character often speaks none in
  // the chapters scanned) keeps book order.
  return rows.sort((a, b) => b.lines - a.lines);
}

/**
 * Roll the chapters and the cast up into the project's state.
 * `stats` is {sceneId: blockStats}; `cast` is [{id, name, voice_id, narrator}];
 * `cache` is the /v1/render/cache-stats body, or null before it loads.
 */
export function projectState({ scenes = [], stats = {}, cast = [], cache = null }) {
  let lines = 0;
  let unplaced = 0;
  let analyzed = 0;
  const byPersona = {};
  for (const s of scenes) {
    const st = stats[s.id];
    if (!st) continue;
    lines += st.speakable;
    unplaced += st.unplaced;
    if (st.analyzed) analyzed += 1;
    for (const [pid, n] of Object.entries(st.byPersona)) byPersona[pid] = (byPersona[pid] || 0) + n;
  }
  const voiceless = cast.filter((p) => !p.voice_id);
  const scanned = scenes.filter((s) => s.metadata?.discover?.scanned_at).length;
  const proposed = proposedSpeakers(scenes, cast).length;
  const blocked = voiceless.reduce((sum, p) => sum + (byPersona[p.id] || 0), 0);
  return {
    chapters: scenes.length,
    scanned,
    proposed,
    analyzed,
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
    case "script":
      return {
        text: state.chapters
          ? `${state.analyzed.toLocaleString()} of ${ch(state.chapters)} analyzed`
          : `No ${unit.plural.toLowerCase()} yet`,
        tag: state.unplaced ? { intent: "danger", label: `${plural(state.unplaced, "line")} need a speaker` } : null,
      };
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

/**
 * The first step with work left — where Continue goes. Null when there is
 * nothing to work on yet (no text), which the Overview says in words instead.
 */
export function continueStep(projectType, state) {
  if (!state.lines) return projectType === "game_voicelines" ? "lines" : null;
  if (projectType !== "game_voicelines") {
    // Discover has work while names wait on Add/Ignore, or while the cast is
    // still only the Narrator and some chapter has never been scanned.
    if (state.proposed || (!state.speakersBesideNarrator && state.scanned < state.chapters)) return "discover";
    if (state.analyzed < state.chapters || state.unplaced) return "script";
  }
  if (state.castVoiced < state.castTotal || state.blocked) return "cast";
  if (state.renderable === null || state.rendered < state.renderable) return "render";
  return "export";
}
