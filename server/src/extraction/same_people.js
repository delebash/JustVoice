// SPDX-License-Identifier: MIT
// Discover's names: the AI suggests, you link (decided 2026-10-16, TASKS "Discover's names: the AI
// suggests, you link — Find same people, Link, Unlink, Kept apart").
//
// A book writes one person several ways — the Queen is "Queen of Hearts" in Alice VII and "the
// Queen" in VIII. Nothing joins those names unseen: every name Discover's scans found is its own
// row until you link it.
//
//   suggestions  Find same people's answers — each group of names the AI says are one person
//                (`merge_names.mergeBook`'s `suggested`), a list to review; Find writes only this
//   links        names you linked as one person ([Link], [Link all], [Link selected as one
//                person]) — or Make the audiobook did (`by: "run"`: one click is its point); a
//                link goes by its speaker's name when one of its names is a speaker, else the
//                fullest name (`merge_names.fullestName`)
//   apart        names you said are different people — Not the same on a suggestion
//                (`from: "suggestion"`) or Unlink (`from: "unlink"`, with the link it came from,
//                so Undo links it back); Find won't suggest them together again, and the run
//                won't link them
//   check        Find's last answer: when, who asked (the button, or the run), the model and its
//                recipe — or why it failed
//
// The state lives on the project, under one key of its metadata (`KEY`, no schema change); the
// routes are extraction_api.js's /v1/projects/{id}/discover/*. These functions are pure: each
// takes the state and the book's speakers (`cast`, [{id, name, aliases}]) and gives the new state;
// the caller writes it, and a speaker's new Also called (`aliases`) when a link or an unlink
// changes it. A name is compared as `names.norm` compares names, and a speaker is found by their
// name or an Also called exactly — as Discover's rows find them (studioStatus.foundSpeakers): a
// first name alone is not a speaker here.

import { isDict, strip } from "@delebash/core/platform/py";
import { pyStrOf } from "@delebash/core/platform/pyjson";
import { badRequest, conflict, notFound } from "../errors.js";
import { fullestName } from "./merge_names.js";
import { norm } from "./names.js";

/** The project metadata key the state is kept under. */
export const KEY = "discover_people";

const text = (v) => (typeof v === "string" && strip(v) ? strip(v) : null);

/** Names, trimmed, each once (`names.norm`), in the order given. */
export function nameList(raw) {
  const out = [];
  const seen = new Set();
  for (const n of Array.isArray(raw) ? raw : []) {
    const name = strip(pyStrOf(n ?? ""));
    const k = norm(name);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(name);
    }
  }
  return out;
}

/** No check yet. */
export const noCheck = () => ({ status: "none", at: null, by: null, model: null, recipe: null, error: null });

/** The state as stored → `{check, suggestions, links, apart}`, read defensively (a value the page
 * can't use is dropped). */
export function readPeople(raw) {
  const r = isDict(raw) ? raw : {};
  const c = isDict(r.check) ? r.check : {};
  const check = c.status === "done" || c.status === "failed"
    ? {
      status: c.status,
      at: text(c.at),
      by: c.by === "run" ? "run" : "button",
      model: text(c.model),
      recipe: c.recipe === "frontier" || c.recipe === "local" ? c.recipe : null,
      error: text(c.error),
    }
    : noCheck();
  const list = (v) => (Array.isArray(v) ? v.filter(isDict) : []);
  const suggestions = list(r.suggestions)
    .map((s) => ({ names: nameList(s.names), name: text(s.name) }))
    .filter((s) => s.names.length > 1)
    .map((s) => ({ names: s.names, name: s.name || fullestName(s.names) }));
  const links = list(r.links)
    .map((l) => ({ names: nameList(l.names), name: text(l.name), by: l.by === "run" ? "run" : "you" }))
    .filter((l) => l.names.length > 1)
    .map((l) => ({ ...l, name: l.name || fullestName(l.names) }));
  const apart = list(r.apart)
    .map((a) => ({
      names: nameList(a.names),
      from: a.from === "unlink" ? "unlink" : "suggestion",
      link: isDict(a.link) && text(a.link.name) ? { name: text(a.link.name), by: a.link.by === "run" ? "run" : "you" } : null,
    }))
    .filter((a) => a.names.length > 1);
  return { check, suggestions, links, apart };
}

const keysOf = (names) => new Set(names.map(norm));
/** The same names, in any order. */
export function sameNames(a, b) {
  const x = keysOf(a);
  const y = keysOf(b);
  return x.size === y.size && [...x].every((k) => y.has(k));
}
/** Every name of `inner` is one of `outer`. */
const within = (inner, outer) => {
  const o = keysOf(outer);
  return inner.every((n) => o.has(norm(n)));
};

/** The link holding this name, or null. */
export function linkOf(state, name) {
  const k = norm(name);
  return state.links.find((l) => l.names.some((n) => norm(n) === k)) ?? null;
}

/** The book's speaker called this — their name or one of their Also called — or null. */
export function speakerCalled(cast, name) {
  const k = norm(name);
  return cast.find((c) => [c.name, ...(c.aliases || [])].some((n) => norm(n) === k)) ?? null;
}

/** The speakers these names are, each once. */
const speakersIn = (cast, names) => [...new Map(names.map((n) => speakerCalled(cast, n)).filter(Boolean).map((s) => [s.id, s])).values()];

/**
 * A Same person? suggestion still to answer: no set you kept apart inside it, not every name in
 * one link already, and not one speaker already — nor two (joining two speakers moves lines: a
 * different feature, decided 2026-10-16).
 */
export function isOpen(state, names, cast) {
  if (names.length < 2) return false;
  if (state.apart.some((a) => within(a.names, names))) return false;
  if (state.links.some((l) => within(names, l.names))) return false;
  const sps = speakersIn(cast, names);
  if (sps.length > 1) return false;
  return !(sps.length === 1 && names.every((n) => speakerCalled(cast, n)?.id === sps[0].id));
}

/** Find's answer joins the list → `{state, added}`: each group still open and not listed yet, going
 * by its fullest name. What was listed before, and your answers, stay. */
export function addSuggestions(state, groups, cast) {
  const suggestions = [...state.suggestions];
  let added = 0;
  for (const g of groups || []) {
    const names = nameList(g);
    if (!isOpen(state, names, cast) || suggestions.some((s) => sameNames(s.names, names))) continue;
    suggestions.push({ names, name: fullestName(names) });
    added += 1;
  }
  return { state: { ...state, suggestions }, added };
}

/**
 * Link names as one person → `{state, speaker, aliases, skipped}`. A link already holding one of
 * them joins in; a set you kept apart inside it is no longer kept apart (you said otherwise). One
 * of them already a speaker: the link goes by the speaker's name and the others become their Also
 * called (`aliases`: the speaker's new list, null when unchanged — `speaker` is who). Two
 * speakers: refused (409). `by`: "you" or "run". `name` (the run's): the name the person goes by
 * when no speaker is among them and it is one of the names; else the fullest name. `strict` (the
 * run): when a set you kept apart would be inside the link, nothing is linked (`skipped`).
 */
export function link(state, names, cast, { by = "you", name = null, strict = false } = {}) {
  const asked = nameList(names);
  if (asked.length < 2) throw badRequest("Link needs two or more names.");
  const askedKeys = keysOf(asked);
  const joined = state.links.filter((l) => l.names.some((n) => askedKeys.has(norm(n))));
  let all = nameList([...joined.flatMap((l) => l.names), ...asked]);
  const sps = speakersIn(cast, all);
  if (sps.length > 1) throw conflict("Two of these names are already speakers in this book — joining speakers isn't done here.");
  const sp = sps[0] ?? null;
  if (sp) all = nameList([sp.name, ...all]);
  if (strict && state.apart.some((a) => within(a.names, all))) return { state, speaker: null, aliases: null, skipped: true };
  const goesBy = sp ? sp.name : name && keysOf(all).has(norm(name)) ? name : fullestName(all);
  const links = [...state.links.filter((l) => !joined.includes(l)), { names: all, name: goesBy, by }];
  const apart = state.apart.filter((a) => !within(a.names, all));
  let aliases = null;
  if (sp) {
    const have = keysOf([sp.name, ...(sp.aliases || [])]);
    const more = all.filter((n) => !have.has(norm(n)));
    if (more.length) aliases = [...(sp.aliases || []), ...more];
  }
  return { state: { ...state, links, apart }, speaker: aliases ? sp : null, aliases, skipped: false };
}

/**
 * Take a name out of the person it was linked to → `{state, speaker, aliases, partner}`: out of its
 * link (a link left with one name goes), out of the speaker's Also called when it is one there
 * (`aliases`: the speaker's new list), and the pair — the person's name (`partner`) and this one —
 * kept apart from "unlink", with the link it came from, so Find won't suggest it again and Undo
 * links it back. Lines already given stay where Script put them. A speaker's own name can't be
 * unlinked (400); a name linked to no one is 404.
 */
export function unlink(state, name, cast) {
  const k = norm(name);
  if (!k) throw badRequest("Unlink needs a name.");
  const was = linkOf(state, name);
  const sp = was ? (speakersIn(cast, was.names)[0] ?? null) : speakerCalled(cast, name);
  if (sp && norm(sp.name) === k) throw badRequest(`${sp.name} is the speaker's own name — it can't be unlinked.`);
  const isAlias = Boolean(sp && (sp.aliases || []).some((a) => norm(a) === k));
  if (!was && !isAlias) throw notFound(`${name} isn't linked to anyone`);
  let links = state.links;
  let rest = null;
  if (was) {
    const left = was.names.filter((n) => norm(n) !== k);
    if (left.length > 1) {
      const goesBy = left.some((n) => norm(n) === norm(was.name)) ? was.name : sp ? sp.name : fullestName(left);
      rest = { names: left, name: goesBy, by: was.by };
    }
    links = [...state.links.filter((l) => l !== was), ...(rest ? [rest] : [])];
  }
  const rowName = sp ? sp.name : was.name;
  const partner = norm(rowName) !== k ? rowName : (rest?.name ?? was.names.find((n) => norm(n) !== k));
  const written = was ? was.names.find((n) => norm(n) === k) : (sp.aliases.find((a) => norm(a) === k) ?? strip(name));
  const pair = [partner, written];
  const apart = state.apart.some((a) => sameNames(a.names, pair))
    ? state.apart
    : [...state.apart, { names: pair, from: "unlink", link: { name: was ? was.name : rowName, by: was ? was.by : "you" } }];
  const aliases = isAlias ? sp.aliases.filter((a) => norm(a) !== k) : null;
  return { state: { ...state, links, apart }, speaker: isAlias ? sp : null, aliases, partner };
}

/** Not the same: a suggestion's names kept apart, from "suggestion" → the new state. Find won't
 * suggest them together again; Undo puts the suggestion back. */
export function notSame(state, names) {
  const group = nameList(names);
  if (group.length < 2) throw badRequest("Keeping names apart needs two or more names.");
  if (state.apart.some((a) => sameNames(a.names, group))) return state;
  return { ...state, apart: [...state.apart, { names: group, from: "suggestion", link: null }] };
}

/**
 * Undo on a pair kept apart → `{state, speaker, aliases, relinked}`: it leaves Kept apart; one
 * that came from Unlink is linked again as it was (its speaker's Also called back too), one that
 * came from Not the same shows under Same person? again. Not kept apart: 404.
 */
export function undoApart(state, names, cast) {
  const group = nameList(names);
  const entry = state.apart.find((a) => sameNames(a.names, group));
  if (!entry) throw notFound("Those names aren't kept apart");
  const left = { ...state, apart: state.apart.filter((a) => a !== entry) };
  if (entry.from !== "unlink") return { state: left, speaker: null, aliases: null, relinked: false };
  const r = link(left, entry.names, cast, { by: entry.link?.by ?? "you", name: entry.link?.name ?? null });
  return { state: r.state, speaker: r.speaker, aliases: r.aliases, relinked: true };
}
