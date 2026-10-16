// SPDX-License-Identifier: MIT
// Voices for the cast and the narrator — the one-click run's step 5 (the one-click plan,
// docs/plans/2026-10-11-one-click-audiobook.md §2 "Voices from the book", §4, slice 3). Decided
// 2026-10-11 (the plan's Q1 and Q3, TASKS "The one-click plan's questions, answered"): every
// speaker with at least N lines in the whole book (`book_voices.min_lines`, 3) gets a voice made
// from the book, the narrator one from the book's genre and tone, and the rest are matched from
// the library.
//
// Three steps, each a function a route calls (api/book_voices_api.js) and the one-click run will
// call (the plan's §4: "Batched by kind" — every description while the language model is loaded,
// then every voice while the design model is):
//
//   1. `describeVoices` — the model writes each voice's description (the two recipes,
//      book_voices/prompts.js). Writes nothing.
//   2. `makeVoices` — each description designed once (`book_voices.design_model`), its audition
//      kept at once as the clip of a voice on `book_voices.clone_model` (the freeze bridge; a held
//      audition lasts 10 minutes), a persona made of it — its note the description and the model
//      that wrote it (the plan's §5) — and the speaker cast with it.
//   3. `matchRest` — the speakers still without a persona: a persona of exactly their name first
//      (as every new speaker is cast), then Smart-assign over the library, applied here.
//
// Nothing replaces a voice or persona you made: a speaker already cast is left alone, and a
// speaker is cast only while it has no persona.

import { LLMNotConfiguredError, presetRecipe, resolveFeaturePreset } from "@delebash/llm-runner/llm";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { cpLen, errText, isJsonObject, pySorted, strip } from "@delebash/llm-runner/platform/py";
import { jsonLoads } from "@delebash/llm-runner/platform/pyjson";
import { personaNamed, sameName, speakerAliases, speakerLineCounts } from "../api/_speaker_helpers.js";
import * as personasApi from "../api/personas_api.js";
import * as smartAssignApi from "../api/smart_assign_api.js";
import * as vp from "../api/voice_preview_api.js";
import { listVoices } from "../api/voices_api.js";
import { getState } from "../app_state.js";
import { Project, Speaker } from "../database/models.js";
import * as run from "../engines/llm/run.js";
import { badRequest, notFound } from "../errors.js";
import { construct, CreatePersonaRequest } from "../models.js";
import { stockLine } from "../persona_render.js";
import * as vmod from "../voice_model.js";
import * as self from "./index.js";
import { ACTIONS, FEATURE } from "./prompts.js";
import { auditionLine, bookChapters, bookManuscript, bookOpening, speakerPassages } from "./text.js";

const log = getLogger("justvoice.book_voices");

/** A voice's language is the book's, so a book needs one first (Cast asks the same, K3). */
export const NO_BOOK_LANGUAGE = "Set the book's language on its Overview first.";

// VoicePreviewRequest's cap on the line an audition speaks.
const AUDITION_MAX_CHARS = 2000;

const seconds = (since) => Math.round((performance.now() - since) / 100) / 10;

/** The recipe Auto runs: the Whole cast row's preset's (the kit's presetRecipe — Frontier for a
 * cloud model unless set otherwise), as speaker attribution's Auto reads its Direct card
 * (pipeline.autoRoute). */
export function describeRecipe() {
  return presetRecipe(resolveFeaturePreset(ACTIONS.cast, FEATURE));
}

/** The narrator's persona name: the speaker's, then the book's title ("Narrator · Alice's
 *  Adventures in Wonderland") — unique per book, as persona names must be. */
export function narratorPersonaName(speakerName, bookName) {
  const book = strip(String(bookName || ""));
  return book ? `${speakerName} · ${book}` : speakerName;
}

function projectOf(h, projectId) {
  const p = h.one(`select * from ${Project} where id = ? limit 1`, [projectId], Project);
  if (p === null) throw notFound(`project ${projectId}`);
  return p;
}

function projectMeta(project) {
  try {
    const meta = jsonLoads(project.metadata_json || "{}");
    return isJsonObject(meta) ? meta : {};
  } catch {
    return {};
  }
}

const settingsOf = () => getState().settings.get().book_voices;

/** "Title — by Author", as the prompts' {{book}} reads it. */
function bookLine(project, meta) {
  const author = strip(String(meta.author || ""));
  return author ? `${project.name} — by ${author}` : project.name;
}

/** A speaker as the model reads them — Smart-assign's line (id, name, role, pronouns, Also called,
 * Who they are), so the two features describe a speaker alike. */
function speakerLine(s) {
  return smartAssignApi._formatCharacters([
    {
      id: s.id,
      name: s.name,
      description: s.description,
      pronouns: s.pronouns,
      aliases: speakerAliases(s),
      role: s.role_label === "narrator" ? "narrator" : null,
    },
  ]);
}

/** "male" / "female", or null — what a voice's gender is stored as. */
export function genderOf(raw) {
  const g = strip(String(raw ?? "")).toLowerCase();
  return g === "male" || g === "female" ? g : null;
}

/** The first JSON object in a model's answer, or null — its thinking left out, as Smart-assign
 * reads its answer. */
export function parseObject(text) {
  const t = strip(String(text || "").replace(/<think>[\s\S]*?<\/think>/g, ""));
  const m = /\{[\s\S]*\}/.exec(t);
  if (!m) return null;
  try {
    const v = jsonLoads(m[0]);
    return isJsonObject(v) ? v : null;
  } catch {
    return null;
  }
}

/** One answer → {gender, description}: the asked-for object, or a bare description. */
function descriptionOf(v) {
  if (typeof v === "string") return { gender: null, description: strip(v) };
  if (isJsonObject(v)) return { gender: genderOf(v.gender), description: strip(String(v.description ?? "")) };
  return { gender: null, description: "" };
}

/**
 * Who gets a voice made from the book → `{targets, narrator, skipped}`. Targets: every speaker but
 * the narrator with at least `minLines` lines in the whole book, most lines first; the narrator:
 * the book's narrator (the role). Either is skipped when it already has a persona (`cast` — left
 * alone) or a persona of exactly its name is in the library (`persona_named` — `matchRest` casts
 * it, as every new speaker is cast: a persona you call "Narrator" narrates every book). The others
 * are for `matchRest`.
 */
export function bookTargets(h, projectId, minLines) {
  const counts = speakerLineCounts(h, projectId);
  const rows = pySorted(h.all(`select * from ${Speaker} where project_id = ?`, [projectId], Speaker), (s) => [
    -(counts.get(s.id) ?? 0),
    s.name.toLowerCase(),
  ]);
  const targets = [];
  const skipped = [];
  let narrator = null;
  for (const s of rows) {
    const lines = counts.get(s.id) ?? 0;
    const isNarrator = s.role_label === "narrator";
    if (!isNarrator && lines < minLines) continue;
    const entry = { speaker_id: s.id, name: s.name, narrator: isNarrator, lines };
    if (s.persona_id) skipped.push({ ...entry, reason: "cast" });
    else if (personaNamed(h, s.name)) skipped.push({ ...entry, reason: "persona_named" });
    else if (isNarrator) narrator = { speaker: s, lines };
    else targets.push({ speaker: s, lines });
  }
  return { targets, narrator, skipped };
}

/**
 * Step 1 — each voice's description (async) → `{recipe, descriptions, skipped, failed, usage,
 * seconds}`. `recipe` "local" / "frontier" forces one; null runs Auto's (`describeRecipe`). Local:
 * one call per speaker with that speaker's paragraphs (`book_voices.speaker_words`), and one for the
 * narrator with the book's opening (`book_voices.narrator_words`); Frontier: one call for all of
 * them with the whole book. Each description records the model that wrote it and the recipe. A
 * failed Local call is listed and the rest go on; no language model set throws the kit's
 * LLMNotConfiguredError. Writes nothing.
 */
export async function describeVoices(h, projectId, { recipe = null } = {}) {
  const started = performance.now();
  const project = projectOf(h, projectId);
  const cfg = settingsOf();
  const chosen = recipe === "local" || recipe === "frontier" ? recipe : self.describeRecipe();
  const { targets, narrator, skipped } = bookTargets(h, projectId, cfg.min_lines);
  const out = {
    recipe: chosen,
    descriptions: [],
    skipped,
    failed: [],
    // RunUsage: `pieces` counts the model calls, `duration_ms` the step's time.
    usage: { prompt_tokens: 0, completion_tokens: 0, duration_ms: 0, model: "", pieces: 0 },
    seconds: 0,
  };
  const everyone = narrator ? [...targets, narrator] : targets;
  if (!everyone.length) return out;

  const chapters = bookChapters(h, projectId);
  const book = bookLine(project, projectMeta(project));
  const counted = (resp) => {
    out.usage.prompt_tokens += resp.prompt_tokens || 0;
    out.usage.completion_tokens += resp.completion_tokens || 0;
    out.usage.model = out.usage.model || resp.model || "";
    out.usage.pieces += 1;
  };
  const entryOf = ({ speaker, lines }) => ({ speaker_id: speaker.id, name: speaker.name, narrator: speaker.role_label === "narrator", lines });
  const record = (target, answer, resp) => {
    const { gender, description } = descriptionOf(answer);
    if (!description) out.failed.push({ ...entryOf(target), error: "The model gave no description." });
    else out.descriptions.push({ ...entryOf(target), gender, description, model: resp.model || null, recipe: chosen });
  };

  if (chosen === "frontier") {
    const nameOf = new Map(h.all(`select id, name from ${Speaker} where project_id = ?`, [projectId]).map((r) => [r.id, r.name]));
    const resp = await run.runFeature(ACTIONS.cast, {
      book,
      speakers: everyone.map((t) => speakerLine(t.speaker)).join("\n"),
      manuscript: bookManuscript(chapters, nameOf),
    });
    counted(resp);
    const answer = parseObject(resp.text) ?? {};
    // By id, as asked; a model that keyed by name is read too.
    const byName = new Map(Object.entries(answer).map(([k, v]) => [sameName(k), v]));
    for (const t of everyone) record(t, Object.hasOwn(answer, t.speaker.id) ? answer[t.speaker.id] : byName.get(sameName(t.speaker.name)), resp);
  } else {
    const ask = async (target, action, variables) => {
      let resp;
      try {
        resp = await run.runFeature(action, variables);
      } catch (e) {
        if (e instanceof LLMNotConfiguredError) throw e;
        log.warning(`book_voices: no description for ${target.speaker.name}: ${errText(e)}`);
        out.failed.push({ ...entryOf(target), error: errText(e) });
        return;
      }
      counted(resp);
      record(target, parseObject(resp.text), resp);
    };
    for (const t of targets) {
      await ask(t, ACTIONS.speaker, {
        book,
        speaker: speakerLine(t.speaker),
        passages: speakerPassages(chapters, t.speaker.id, cfg.speaker_words),
      });
    }
    if (narrator) await ask(narrator, ACTIONS.narrator, { book, opening: bookOpening(chapters, cfg.narrator_words) });
  }
  out.seconds = seconds(started);
  out.usage.duration_ms = Math.round(out.seconds * 1000);
  log.info(
    `book_voices: ${out.descriptions.length} described (${chosen}, ${out.usage.model || "no model"}), ${out.failed.length} failed, ${out.seconds} s`,
  );
  return out;
}

/** Cast the speaker with this persona only while it has none → whether it was cast. */
function castIfUncast(h, speakerId, personaId) {
  return h.update(Speaker, { persona_id: personaId }, "id = ? and persona_id is null", [speakerId]).changes > 0;
}

/** The persona's note: the description, then the model that wrote it (the plan's §5). */
export function personaNote(description, model) {
  return model ? `${description}\n\nWritten from the book by ${model}.` : description;
}

/** The design and clone models, checked → the design model's engine. A clone model must clone and
 * still take direction (the plan's step 5: written direction or tags). Both must speak the book's
 * language. */
function checkedModels(st, cfg, language) {
  const designEngine = vmod.engineOfModel(cfg.design_model);
  if (designEngine === null || !vmod.can(cfg.design_model, "design")) {
    throw badRequest(`${vmod.modelName(cfg.design_model)} can't design a voice from words — set book_voices.design_model to one that can.`);
  }
  const cloneEngine = vmod.engineOfModel(cfg.clone_model);
  const directed = vmod.directedBy(cfg.clone_model);
  if (cloneEngine === null || !vmod.can(cfg.clone_model, "clone") || (directed !== vmod.WORDS && directed !== vmod.TAGS)) {
    throw badRequest(
      `${vmod.modelName(cfg.clone_model)} can't keep a voice from its clip and still take direction — set book_voices.clone_model to one that can.`,
    );
  }
  for (const [engine, model] of [
    [designEngine, cfg.design_model],
    [cloneEngine, cfg.clone_model],
  ]) {
    const vm = vmod.describe(st, engine, model, null);
    if (vm.speaks.length && !vmod.speaksLanguage(vm, language)) {
      throw badRequest(`${vm.name} can't speak ${language} — it speaks ${vm.speaks.join(", ")}.`);
    }
  }
  return designEngine;
}

/**
 * Step 2 — a voice, a persona and the cast for each description (async) → `{made, cast_by_name,
 * left_alone, failed, seconds}`. `descriptions` are step 1's. Each is designed once on
 * `book_voices.design_model`, speaking the speaker's own calm line (`text.auditionLine`; a stock
 * line when they have none long enough); the audition is kept at once as the clip of a voice on
 * `book_voices.clone_model` with the description as its `design_prompt`; a persona named after the
 * speaker is made of it, its note the description and the model that wrote it; the speaker is cast
 * with it. A speaker already cast is left alone; one whose name is exactly a persona's is cast with
 * that persona instead. A failure is listed and the rest go on — and a voice made for a persona that
 * then couldn't be made is removed.
 */
export async function makeVoices(h, projectId, descriptions, { signal = null } = {}) {
  const started = performance.now();
  const project = projectOf(h, projectId);
  const language = strip(String(projectMeta(project).language || ""));
  if (!language) throw badRequest(NO_BOOK_LANGUAGE);
  const st = getState();
  const cfg = settingsOf();
  const designEngine = checkedModels(st, cfg, language);
  const chapters = bookChapters(h, projectId);
  const out = { made: [], cast_by_name: [], left_alone: [], failed: [], seconds: 0 };

  for (const d of descriptions) {
    if (signal?.aborted) break;
    const speaker = h.get(Speaker, d.speaker_id);
    const entry = { speaker_id: d.speaker_id, name: speaker?.name ?? d.name ?? "" };
    if (speaker === null || speaker.project_id !== projectId) {
      out.failed.push({ ...entry, error: "No such speaker in this book." });
      continue;
    }
    if (speaker.persona_id) {
      out.left_alone.push(entry);
      continue;
    }
    const narrator = speaker.role_label === "narrator";
    // The narrator's persona carries the book's title (2026-10-16): named "Narrator" it would be
    // cast by name as the next book's narrator too (+ Add Narrator's rule for a persona you call
    // "Narrator"), and that book's would never be designed from its own genre and tone (Q3).
    const personaName = narrator ? narratorPersonaName(speaker.name, project.name) : speaker.name;
    const named = personaNamed(h, personaName);
    if (named) {
      if (castIfUncast(h, speaker.id, named)) out.cast_by_name.push({ ...entry, persona_id: named });
      continue;
    }
    const description = strip(String(d.description || ""));
    if (!description) {
      out.failed.push({ ...entry, error: "No description to design the voice from." });
      continue;
    }
    try {
      // The name the persona will take — refused before a voice is designed for it.
      personasApi._personaName(personaName);
    } catch (e) {
      out.failed.push({ ...entry, error: errText(e) });
      continue;
    }
    const line = auditionLine(chapters, speaker.id, cfg.audition_words, { narration: narrator });
    const audition = line && cpLen(line) <= AUDITION_MAX_CHARS ? line : stockLine(language);
    const t0 = performance.now();
    let voiceId = null;
    try {
      const heard = await vp.previewVoice(
        vp.voicePreviewRequest({
          engine: designEngine,
          model: cfg.design_model,
          source: "designed",
          prompt: description,
          preview_text: audition,
          language,
        }),
        { signal },
      );
      // Kept at once: a held audition lasts 10 minutes (the plan's §4).
      const saved = await vp.savePreview(heard.previewId, { name: personaName, gender: genderOf(d.gender), model: cfg.clone_model });
      voiceId = saved.voice_id;
      const persona = await personasApi.createPersona(
        construct(CreatePersonaRequest, { name: personaName, voice_id: voiceId, language, note: personaNote(description, d.model) }),
      );
      out.made.push({
        ...entry,
        narrator,
        voice_id: voiceId,
        persona_id: persona.id,
        cast: castIfUncast(h, speaker.id, persona.id),
        audition,
        seconds: seconds(t0),
      });
    } catch (e) {
      if (voiceId !== null) st.voices.delete(voiceId);
      if (signal?.aborted) break;
      log.warning(`book_voices: no voice for ${speaker.name}: ${errText(e)}`);
      out.failed.push({ ...entry, error: errText(e) });
    }
  }
  out.seconds = seconds(started);
  log.info(`book_voices: ${out.made.length} voices made on ${cfg.design_model} → ${cfg.clone_model}, ${out.failed.length} failed, ${out.seconds} s`);
  return out;
}

/** A voice's gender as Smart-assign is told it: "female" / "male" / "neutral", or null. */
function genderWord(raw) {
  const c = strip(String(raw || ""))
    .charAt(0)
    .toUpperCase();
  return { F: "female", M: "male", N: "neutral" }[c] ?? null;
}

/**
 * Step 3 — the speakers still without a persona (async) → `{cast_by_name, assigned, unmatched, note,
 * usage, seconds}`. A speaker whose name is exactly one persona's is cast with it; the rest go to
 * Smart-assign with the personas in your library that speak the book's language and play no one in
 * this book yet, and its matches are cast here (`applyAssignments`, never over a persona). Throws
 * the kit's LLMNotConfiguredError when there are speakers to match and no language model.
 */
export async function matchRest(h, projectId) {
  const started = performance.now();
  const project = projectOf(h, projectId);
  const language = strip(String(projectMeta(project).language || ""));
  if (!language) throw badRequest(NO_BOOK_LANGUAGE);
  const st = getState();
  const out = { cast_by_name: [], assigned: [], unmatched: [], note: null, usage: null, seconds: 0 };

  const rest = [];
  for (const s of h.all(`select * from ${Speaker} where project_id = ? order by name`, [projectId], Speaker)) {
    if (s.persona_id) continue;
    const named = personaNamed(h, s.name);
    if (named) {
      if (castIfUncast(h, s.id, named)) out.cast_by_name.push({ speaker_id: s.id, name: s.name, persona_id: named });
    } else rest.push(s);
  }
  if (rest.length) {
    const inBook = new Set(
      h.all(`select persona_id from ${Speaker} where project_id = ? and persona_id is not null`, [projectId]).map((r) => r.persona_id),
    );
    const genders = new Map((await listVoices()).voices.map((v) => [v.id, genderWord(v.gender)]));
    const seen = new Map();
    const pool = [];
    for (const p of st.personas.list()) {
      if (!p.voice_id || inBook.has(p.id)) continue;
      const view = await personasApi._view(st, p, seen);
      if (!view.speaks || vmod.baseLang(view.speaks) !== vmod.baseLang(language)) continue;
      pool.push({ id: p.id, name: p.name, gender: genders.get(p.voice_id) ?? null, language: view.speaks, tone: p.note || null });
    }
    let applied = {};
    if (pool.length) {
      const characters = rest.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        aliases: speakerAliases(s),
        pronouns: s.pronouns,
        role: s.role_label === "narrator" ? "narrator" : null,
      }));
      const r = await smartAssignApi.smartAssign(characters, pool);
      applied = smartAssignApi.applyAssignments(h, r.assignments, { onlyUncast: true });
      out.note = r.note;
      out.usage = r.usage;
    }
    const names = new Map(pool.map((p) => [p.id, p.name]));
    for (const s of rest) {
      if (applied[s.id]) out.assigned.push({ speaker_id: s.id, name: s.name, persona_id: applied[s.id], persona_name: names.get(applied[s.id]) });
      else out.unmatched.push({ speaker_id: s.id, name: s.name });
    }
  }
  out.seconds = seconds(started);
  return out;
}
