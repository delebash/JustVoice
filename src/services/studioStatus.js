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
} from "./attribution.js";
import { CANT_RENDER } from "./lineStates.js";

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

// Name comparison, the same rules as the server's extraction/names.js `norm`.
const normName = (n) => (n || "").normalize("NFKC").replace(/’/g, "'").toLowerCase()
  .replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
/** Two spellings are the same name — case, curly quotes and punctuation aside. */
export const sameName = (a, b) => normName(a) === normName(b);

// The articles a name can start with — the server's `names.bare` (extraction/names.js), which
// only Find same people's example reads here.
const LEADING_ARTICLES = new Set(["the", "a", "an", "le", "la", "les", "l'", "der", "die", "das", "el", "los", "las", "il", "lo", "gli"]);
const words = (n) => normName(n).split(" ").filter(Boolean);
function bareWords(n) {
  const w = words(n);
  if (w.length > 1 && LEADING_ARTICLES.has(w[0])) return w.slice(1);
  if (w.length && /^l'./u.test(w[0])) return [w[0].slice(2), ...w.slice(1)];
  return w;
}
/** One name is the other with whole words added, a leading article aside ("the Queen" / "Queen
 * of Hearts") — the server's `names.isVariantBare`. */
function containsName(a, b) {
  const x = bareWords(a);
  const y = bareWords(b);
  if (!x.length || !y.length || x.join(" ") === y.join(" ")) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  for (let i = 0; i + short.length <= long.length; i += 1) {
    if (short.every((w, j) => long[i + j] === w)) return true;
  }
  return false;
}

/**
 * The book's own example for Discover's line, "Some people are named more than one way — “the
 * Queen” and “Queen of Hearts”": the first two names, in book order, of which one is the other
 * with words added (a leading article aside), the shorter first — or null. Names you linked
 * already aren't an example.
 */
export function examplePair(names, links = []) {
  const linked = new Set((links || []).flatMap((l) => (l.names || []).map(normName)));
  const open = (names || []).filter((n) => !linked.has(normName(n)));
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      if (containsName(open[i], open[j])) {
        return bareWords(open[i]).length <= bareWords(open[j]).length ? [open[i], open[j]] : [open[j], open[i]];
      }
    }
  }
  return null;
}

/**
 * Each name the saved scans found, once (compared as the server compares names), in book order:
 * `{name, key, lines, mentions, chapters, evidence, evidence_found}` — the AI's names
 * (`candidates`) and the speakers each chapter names (`named_cast`).
 */
export function foundNames(scenes) {
  const out = new Map();
  for (const s of scenes || []) {
    const saved = s.metadata?.discover;
    if (!saved) continue;
    for (const c of [...(saved.named_cast || []), ...(saved.candidates || [])]) {
      const name = (c.name || "").trim();
      const key = normName(name);
      if (!key) continue;
      let n = out.get(key);
      if (!n) {
        n = { name, key, lines: 0, mentions: 0, chapters: [], evidence: "", evidence_found: null };
        out.set(key, n);
      }
      n.lines += c.approx_lines || 0;
      n.mentions += c.mentions || 0;
      if (!n.evidence && c.evidence) Object.assign(n, { evidence: c.evidence, evidence_found: c.evidence_found ?? null });
      if (!n.chapters.includes(s.id)) n.chapters.push(s.id);
    }
  }
  return [...out.values()];
}

/**
 * Everyone a project's saved scans found, each person once with a status —
 * Discover's record (decided 2026-09-29):
 *   "cast"    a speaker of this book; `speaker` is who
 *   "library" no speaker yet, but a persona in the library has exactly this
 *             name; Add makes the speaker already cast with it (`persona`)
 *   "new"     no speaker, no persona of that name; Add makes the speaker
 *   "ignored" on the project's ignore list; Undo takes it off
 * [{key, status, name, names, speaker, persona, link, role_hint, evidence,
 *   evidence_found, lines, mentions, chapters}], waiting rows first.
 *
 * A saved scan holds the AI's names that were not speakers (`candidates`,
 * ignored ones included) and the speakers the text names (`named_cast`, found
 * by name without the AI). The status is worked out now, not at scan time, so
 * someone added, removed or ignored since shows as such — Add and Ignore change
 * a row, they never remove it; a removed speaker's row turns New.
 *
 * One row per person: everything that points at one speaker — their name or an
 * Also called, exactly — is their row; every other name is its own row until
 * you link it (decided 2026-10-16, "Discover's names: the AI suggests, you
 * link": nothing joins spellings unseen). Names linked as one person (`links`,
 * the project's `discover_people.links` — `[{names, name, by}]`) are one row,
 * going by the link's name, or the speaker's when one of them is a speaker;
 * `link` is that link. A linked row is Ignored when one of its names is.
 * `cast` is the book's speakers [{id, name, aliases}] (names alone are accepted
 * too); `ignored` the project's ignore list; `personas` the library.
 */
const STATUS_ORDER = { new: 0, library: 1, cast: 2, ignored: 3 };
export function foundSpeakers(scenes, cast = [], ignored = [], personas = [], links = []) {
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
  const linkOf = (key) => (links || []).find((l) => (l.names || []).some((n) => normName(n) === key)) ?? null;
  const speakerOfLink = (l) => (l.names || []).map((n) => castByName.get(normName(n))).find((c) => c?.id) ?? null;

  const rows = new Map();
  const note = (row, s, name, c) => {
    const clean = (name || "").trim();
    if (clean && !row.names.includes(clean)) row.names.push(clean);
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
  // One name, onto its person's row: the speaker it is (`sp` — the scan's own record of a speaker
  // the chapter names — else by name), else its link, else its own.
  const place = (s, name, c, sp = null) => {
    const key = normName(name);
    if (!key) return;
    const link = linkOf(key);
    const speaker = sp ?? (castByName.get(key)?.id ? castByName.get(key) : null) ?? (link ? speakerOfLink(link) : null);
    const id = speaker ? `s:${speaker.id}` : link ? `l:${normName(link.name)}` : `n:${key}`;
    let row = rows.get(id);
    if (!row) {
      row = blank(id, speaker ? speaker.name : link ? link.name : name);
      if (speaker) row.speaker = { id: speaker.id, name: speaker.name };
      rows.set(id, row);
    }
    if (link && !row.link) row.link = link;
    note(row, s, name, c);
  };
  for (const s of scenes || []) {
    const saved = s.metadata?.discover;
    if (!saved) continue;
    // A speaker removed since the scan is a name like any other.
    for (const m of saved.named_cast || []) place(s, m.name, m, castById.get(m.speaker_id) ?? null);
    for (const c of saved.candidates || []) place(s, c.name, c);
  }
  const out = [];
  for (const row of rows.values()) {
    if (row.speaker) {
      row.status = "cast";
    } else {
      const keys = row.names.map(normName);
      const persona = keys.map((k) => personaByName.get(k)).find(Boolean);
      row.status = keys.some((k) => ignoredNames.has(k)) ? "ignored" : persona ? "library" : "new";
      if (row.status === "library") row.persona = { id: persona.id, name: persona.name };
      row.key = `${row.status}:${normName(row.name)}`;
    }
    out.push(row);
  }
  // Waiting rows first; then most lines, then most mentions; a tie keeps book
  // order (a named speaker often speaks none in the chapters scanned).
  return out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || b.lines - a.lines || b.mentions - a.mentions);
}
function blank(key, name) {
  return {
    key, status: null, name: (name || "").trim(), names: [], speaker: null, persona: null, link: null,
    role_hint: "", evidence: "", evidence_found: null, lines: 0, mentions: 0, chapters: [],
  };
}
/** A row still waiting for Add or Ignore. */
export const isWaiting = (r) => r.status === "new" || r.status === "library";

/**
 * Find same people's answers still to review — Discover's Same person? list (decided
 * 2026-10-16) → [{key, names, name, lines, chapters, quotes: [{name, evidence}]}]. From the
 * project's `discover_people` (`people`): each suggestion whose names the scans still find, not
 * every name in one link already, no set you kept apart inside it, and not one speaker already —
 * nor two (the server's `same_people.isOpen`). Lines are the scans' counts, both names together.
 */
export function sameSuggestions(scenes, people, cast = []) {
  if (!people) return [];
  const info = new Map(foundNames(scenes).map((n) => [n.key, n]));
  const castRows = cast.map((c) => (typeof c === "string" ? { id: null, name: c } : c));
  const speakerOf = (n) => castRows.find((c) => [c.name, ...(c.aliases || [])].some((x) => normName(x) === normName(n))) ?? null;
  const inside = (inner, outer) => {
    const o = new Set(outer.map(normName));
    return inner.every((n) => o.has(normName(n)));
  };
  const out = [];
  for (const s of people.suggestions || []) {
    const names = s.names || [];
    if (names.length < 2 || !names.every((n) => info.has(normName(n)))) continue;
    if ((people.links || []).some((l) => inside(names, l.names || []))) continue;
    if ((people.apart || []).some((a) => inside(a.names || [], names))) continue;
    const sps = [...new Set(names.map(speakerOf).filter(Boolean))];
    if (sps.length > 1 || (sps.length === 1 && names.every((n) => speakerOf(n) === sps[0]))) continue;
    const found = names.map((n) => info.get(normName(n)));
    out.push({
      key: names.map(normName).join("|"),
      names,
      name: s.name,
      lines: found.reduce((sum, n) => sum + n.lines, 0),
      chapters: [...new Set(found.flatMap((n) => n.chapters))],
      quotes: found.filter((n) => n.evidence).map((n) => ({ name: n.name, evidence: n.evidence })),
    });
  }
  return out;
}

/**
 * Roll the chapters and the cast up into the project's state.
 * `stats` is {sceneId: blockStats}; `cast` is the book's speakers [{id, name,
 * aliases, ready, narrator}] — `ready` = played by a persona that has a voice;
 * `ignored` is the project's Discover ignore list; `links` its names linked as
 * one person (`discover_people.links`); `personas` the library;
 * `render` is GET /v1/projects/{id}/render_state's `totals` (§8.16's counts:
 * lines, needs_speaker, needs_voice, ready, rendered, stale — Studio Slice 4),
 * or null before it loads;
 * `script` is GET /v1/projects/{id}/script's chapters (the flags are the
 * server's), or null before it loads; `running` counts chapters being analyzed.
 */
export function projectState({
  scenes = [], scenesLoaded = true, speakersLoaded = true, stats = {}, cast = [], ignored = [], links = [], personas = [],
  render = null, script = null, running = 0,
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
  // Narration needs a narrator (2026-10-05): read, not spoken, in Script's rows.
  const narration = (script || []).reduce((n, c) => n + Math.max(0, (c.lines || 0) - (c.spoken || 0)), 0);
  const noNarrator = narration > 0 && !cast.some((sp) => sp.narrator);
  const scanned = scenes.filter((s) => s.metadata?.discover?.scanned_at).length;
  // Found names still waiting for Add or Ignore.
  const proposed = foundSpeakers(scenes, cast, ignored, personas, links).filter(isWaiting).length;
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
    noNarrator,
    blocked,
    // Every chapter's lines read (the step cards say "Checking the lines…" until
    // then — 2026-10-07: a game's sheet read "No lines yet" for 1–3 s).
    linesLoaded: scenesLoaded && scenes.every((s) => stats[s.id]),
    // The chapter list and the speakers read — until then the cards say "Checking…".
    chaptersLoaded: scenesLoaded,
    castLoaded: speakersLoaded,
    // Lines that can't render, as Render counts them (its header's "· N can't render").
    cantRender: render ? (render.needs_speaker || 0) + (render.needs_voice || 0) : 0,
    // Rendered = a take that is current (services/lineStates.js, 2026-10-06): a
    // stale line still plays its take but isn't counted rendered — Render's own
    // numbers. Of the lines that can render; `ready` have no take yet.
    rendered: render ? render.rendered : null,
    renderable: render ? render.ready + render.rendered + render.stale : null,
    ready: render ? render.ready : 0,
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
      if (state.chaptersLoaded === false) return { text: `Checking the ${unit.plural.toLowerCase()}…`, tag: null };
      return {
        text: state.chapters
          ? `${state.scanned.toLocaleString()} of ${ch(state.chapters)} scanned`
          : `No ${unit.plural.toLowerCase()} yet`,
        tag: state.proposed
          ? { intent: "accent2", label: `${plural(state.proposed, "speaker")} to review` }
          : null,
      };
    case "script": {
      if (state.linesLoaded === false) return { text: `Checking the ${unit.plural.toLowerCase()}…`, tag: null, tags: [] };
      if (!state.chapters) return { text: `No ${unit.plural.toLowerCase()} yet`, tag: null, tags: [] };
      const toCheck = { go: ["script", "check"], title: `Opens Script on the ${unit.plural.toLowerCase()} to check` };
      const tags = [
        // Narration with no narrator: one fix, on Cast (Add Narrator) — 2026-10-05.
        ...(state.noNarrator ? [{ intent: "danger", label: "no narrator", go: ["cast"],
          title: "This book has narration and no narrator — Add Narrator on Cast gives it one" }] : []),
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
      if (state.linesLoaded === false) return { text: "Checking the lines…", tag: null };
      return {
        text: state.lines ? plural(state.lines, "line") : "No lines yet — re-import the sheet",
        tag: null,
      };
    case "cast":
      if (state.castLoaded === false) return { text: "Checking the speakers…", tag: null };
      return {
        text: state.castTotal
          ? `${state.castReady.toLocaleString()} of ${plural(state.castTotal, "speaker")} cast`
          : "No speakers yet",
        tag: state.blocked ? { intent: "danger", label: `${plural(state.blocked, "line")} ${CANT_RENDER}` } : null,
      };
    case "render":
      if (state.renderable === null) return { text: "Checking what is rendered…", tag: null };
      return {
        // The lines that can't render are named beside it (2026-10-07: a game's
        // sheet read "0 of 4 lines rendered" with 8 more it didn't mention).
        text: (state.renderable
          ? `${state.rendered.toLocaleString()} of ${plural(state.renderable, "line")} rendered`
          : "Nothing can render yet")
          + (state.cantRender ? ` · ${state.cantRender.toLocaleString()} ${CANT_RENDER}` : ""),
        tag: state.ready
          ? { intent: "accent2", label: `${state.ready.toLocaleString()} to go` }
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

