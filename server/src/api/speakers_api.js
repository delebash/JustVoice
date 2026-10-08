// SPDX-License-Identifier: MIT
// /v1/projects/{id}/speakers, /v1/speakers/{id} — the people in a book (the port of
// justvoice/api/speakers_api.py).
//
// Decided 2026-09-29: a speaker is a person in one book (name, "Also called", who they are);
// Cast gives each speaker a persona — the finished voice, from the library — and one persona
// can play many speakers. These routes replace the project ↔ persona cast link
// (`/v1/projects/{id}/cast`), which is gone.
//
// The narrator is a speaker holding the "narrator" role, one per book; no book gets one on its
// own (+ Add Narrator, or a book's own "Narrator" character).

import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { pySorted, splitWs, strip } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Block, Persona, Project, Scene, Speaker, SpeakerCorrection } from "../database/models.js";
import * as session from "../database/session.js";
import * as run from "../engines/llm/run.js";
import { badRequest, HttpError, notFound } from "../errors.js";
import { construct, CreateSpeakerRequest, Speaker as SpeakerOut, SpeakerList, UpdateSpeakerRequest } from "../models.js";
import {
  cleanAliases,
  ensureSpeaker,
  moveNarration,
  narratorSpeakerId,
  personaNamed,
  refuseSameName,
  sameName,
  speakerAliases,
  speakerLineCounts,
} from "./_speaker_helpers.js";
import { RunUsage } from "./extraction_api.js";
import { _dirtyUpdate } from "./projects_api.js";
import { sentBody } from "./settings_api.js";

export { personaNamed };

const errText = (e) => e?.message ?? String(e);
const speakerById = (h, id) => h.get(Speaker, id);

/** A speaker as the API shows it. */
function _out(s, names, counts) {
  return construct(SpeakerOut, {
    id: s.id,
    project_id: s.project_id,
    name: s.name,
    aliases: speakerAliases(s),
    description: s.description,
    persona_id: s.persona_id,
    persona_name: s.persona_id ? (names.get(s.persona_id) ?? null) : null,
    role_label: s.role_label,
    pronouns: s.pronouns,
    lines: counts.get(s.id) ?? 0,
    imported_from: s.imported_from,
  });
}

/** The book's speakers, most lines first (the narrator's narration counts), then by name. */
export function listSpeakers(h, projectId) {
  const rows = h.all(`select * from ${Speaker} where project_id = ?`, [projectId], Speaker);
  const ids = [...new Set(rows.filter((s) => s.persona_id).map((s) => s.persona_id))];
  const names = new Map(
    ids.length ? h.all(`select id, name from ${Persona} where id in (${ids.map(() => "?").join(", ")})`, ids).map((r) => [r.id, r.name]) : [],
  );
  const counts = speakerLineCounts(h, projectId);
  return pySorted(
    rows.map((s) => _out(s, names, counts)),
    (s) => [-s.lines, s.name.toLowerCase()],
  );
}

function _one(h, s) {
  let names = new Map();
  if (s.persona_id) {
    const p = h.get(Persona, s.persona_id);
    names = p ? new Map([[p.id, p.name]]) : new Map();
  }
  return _out(s, names, speakerLineCounts(h, s.project_id));
}

function _project(h, projectId) {
  const p = h.one(`select * from ${Project} where id = ? limit 1`, [projectId], Project);
  if (p === null) throw notFound(`project ${projectId}`);
  return p;
}

function _personaOr404(h, personaId) {
  if (h.get(Persona, personaId) === null) throw notFound(`persona ${personaId}`);
}

// ── The narrator ─────────────────────────────────────────────────────────

export const SetNarratorRequest = T.Object({ speaker_id: T.String() });

export const NarratorResponse = T.Object({
  ...SpeakerList.properties,
  // Narration lines that moved to the narrator.
  moved_lines: opt(T.Integer(), 0),
});

// ── Rewrite in character (Script's right-click) ──────────────────────────

export const SpeakerRewriteRequest = T.Object({ text: T.String() });

export const SpeakerRewriteResponse = T.Object({
  original: T.String(),
  rewritten: T.String(),
  speaker_id: T.String(),
  usage: opt(nullable(RunUsage), null),
});

export async function router(app) {
  app.get("/v1/projects/:project_id/speakers", async (req) => {
    const h = session.getDb();
    _project(h, req.params.project_id);
    return construct(SpeakerList, { speakers: listSpeakers(h, req.params.project_id) });
  });

  /** Cast's ＋ Add: a speaker by name. Refused when the book already has that name; cast with
   * the persona of exactly its name unless one is given. */
  app.post("/v1/projects/:project_id/speakers", { schema: { body: CreateSpeakerRequest } }, async (req, reply) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    const body = req.body;
    _project(h, projectId);
    if (body.persona_id) _personaOr404(h, body.persona_id);
    const speaker = h.tx(() => {
      const [s] = ensureSpeaker(h, projectId, {
        name: body.name,
        description: body.description,
        aliases: body.aliases,
        unique: true,
        pronouns: body.pronouns,
      });
      if (body.persona_id) _dirtyUpdate(h, Speaker, s, { persona_id: body.persona_id });
      return s;
    });
    reply.code(201);
    return _one(h, speakerById(h, speaker.id));
  });

  /** Rename, "Also called", "Who they are", Pronouns (`null` = not set), and the cast — the
   * persona that plays them (`persona_id: null` un-casts). A rename is refused when the book
   * already has a speaker by the new name. */
  app.patch("/v1/speakers/:speaker_id", { schema: { body: UpdateSpeakerRequest } }, async (req) => {
    const h = session.getDb();
    const id = req.params.speaker_id;
    const body = req.body;
    const s = speakerById(h, id);
    if (s === null) throw notFound(`speaker ${id}`);
    const sent = new Set(Object.keys(sentBody(req) || {}));
    const cur = { ...s };
    if (body.name !== null) {
      const name = splitWs(body.name).join(" ");
      if (sameName(name) !== sameName(cur.name)) refuseSameName(h, cur.project_id, name, { besides: cur.id });
      cur.name = name;
    }
    if (body.aliases !== null) {
      const kept = cleanAliases(body.aliases, cur.name);
      cur.aliases = kept.length ? pyJson(kept) : null;
    } else if (body.name !== null) {
      // A rename can make an alias the speaker's own name — drop it.
      const kept = cleanAliases(speakerAliases(cur), cur.name);
      cur.aliases = kept.length ? pyJson(kept) : null;
    }
    if (sent.has("description")) cur.description = strip(body.description || "") || null;
    if (sent.has("pronouns")) cur.pronouns = body.pronouns;
    if (sent.has("persona_id")) {
      if (body.persona_id) _personaOr404(h, body.persona_id);
      cur.persona_id = body.persona_id || null;
    }
    h.tx(() =>
      _dirtyUpdate(h, Speaker, s, {
        name: cur.name,
        aliases: cur.aliases,
        description: cur.description,
        pronouns: cur.pronouns,
        persona_id: cur.persona_id,
      }),
    );
    return _one(h, speakerById(h, id));
  });

  /** Remove a speaker from the book. Their lines go back to no speaker and their saved fixes
   * forget them; the persona that played them stays in the library. (Studio asks first —
   * decided 2026-09-29.) */
  app.delete("/v1/speakers/:speaker_id", async (req) => {
    const h = session.getDb();
    const id = req.params.speaker_id;
    const s = speakerById(h, id);
    if (s === null) throw notFound(`speaker ${id}`);
    const sceneIds = h.all(`select id from ${Scene} where project_id = ?`, [s.project_id]).map((r) => r.id);
    let lines = 0;
    h.tx(() => {
      if (sceneIds.length) {
        lines = h.update(Block, { speaker_id: null }, `scene_id in (${sceneIds.map(() => "?").join(", ")}) and speaker_id = ?`, [...sceneIds, s.id]).changes;
      }
      h.update(SpeakerCorrection, { speaker_id: null }, { speaker_id: s.id });
      h.delete(Speaker, { id: s.id });
    });
    return { deleted: true, lines };
  });

  /** Cast's ✕ Clear cast: every speaker loses its persona. The speakers stay. */
  app.post("/v1/projects/:project_id/speakers/uncast", async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    _project(h, projectId);
    h.update(Speaker, { persona_id: null }, { project_id: projectId });
    return construct(SpeakerList, { speakers: listSpeakers(h, projectId) });
  });

  /** Make one speaker the book's narrator (any speaker can be — a first-person narrator
   * narrates AND speaks, one voice). The role comes off whoever held it; narration follows it
   * (`moveNarration`). */
  app.put("/v1/projects/:project_id/narrator", { schema: { body: SetNarratorRequest } }, async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    _project(h, projectId);
    const s = speakerById(h, req.body.speaker_id);
    if (s === null || s.project_id !== projectId) throw badRequest("That speaker isn't in this book.");
    const oldId = narratorSpeakerId(h, projectId);
    if (oldId === s.id && s.role_label === "narrator") return construct(NarratorResponse, { speakers: listSpeakers(h, projectId) });
    const moved = h.tx(() => {
      h.update(Speaker, { role_label: null }, "project_id = ? and role_label = 'narrator' and id != ?", [projectId, s.id]);
      const n = moveNarration(h, projectId, s.id, oldId);
      _dirtyUpdate(h, Speaker, s, { role_label: "narrator" });
      return n;
    });
    return construct(NarratorResponse, { speakers: listSpeakers(h, projectId), moved_lines: moved });
  });

  /** Studio Cast's "+ Add Narrator". Idempotent: a book that has a narrator comes back
   * unchanged. Else a speaker called Narrator takes the role, or a new speaker "Narrator" is made
   * — cast with the persona of exactly that name when there is one. Narration with no speaker
   * then moves to it. */
  app.post("/v1/projects/:project_id/narrator", async (req, reply) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    _project(h, projectId);
    reply.code(201);
    if (h.one(`select id from ${Speaker} where project_id = ? and role_label = 'narrator' limit 1`, [projectId]) !== null) {
      return construct(NarratorResponse, { speakers: listSpeakers(h, projectId) });
    }
    const moved = h.tx(() => {
      let existing = h.all(`select * from ${Speaker} where project_id = ?`, [projectId], Speaker).find((s) => sameName(s.name) === "narrator") ?? null;
      if (existing === null) {
        [existing] = ensureSpeaker(h, projectId, {
          name: "Narrator",
          description: "The book's narrator: reads everything that is not a speaker's line.",
        });
      }
      const n = moveNarration(h, projectId, existing.id, null);
      _dirtyUpdate(h, Speaker, existing, { role_label: "narrator" });
      return n;
    });
    return construct(NarratorResponse, { speakers: listSpeakers(h, projectId), moved_lines: moved });
  });

  /** Script's "Rewrite in character": the speaker's "Who they are" is the character (it moved
   * off the persona 2026-09-29). Same `persona_rewrite` template row as the persona page's
   * Rewrite, which reads a persona's note instead. */
  app.post("/v1/speakers/:speaker_id/rewrite", { schema: { body: SpeakerRewriteRequest } }, async (req) => {
    const h = session.getDb();
    const id = req.params.speaker_id;
    const s = speakerById(h, id);
    if (s === null) throw notFound(`speaker ${id}`);
    const who = strip(s.description || "");
    if (!who) throw new HttpError(400, `${s.name} has nothing under Who they are — write it on Cast to rewrite as them.`);
    if (!strip(req.body.text)) throw new HttpError(400, "rewrite requires non-empty text");
    let resp;
    try {
      resp = await run.runFeature("persona_rewrite", { personality: who, text: req.body.text });
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
      throw new HttpError(502, `LLM call failed: ${errText(e)}`);
    }
    return construct(SpeakerRewriteResponse, {
      original: req.body.text,
      rewritten: strip(resp.text),
      speaker_id: id,
      usage: { prompt_tokens: resp.prompt_tokens, completion_tokens: resp.completion_tokens, model: resp.model },
    });
  });
}
