// SPDX-License-Identifier: MIT
// /v1/lexicons CRUD (the port of justvoice/api/lexicons_api.py).

import { Hono, input } from "@delebash/llm-runner/platform";
import { getState } from "../app_state.js";
import { Block, Persona, Project, Scene, Speaker } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { wordsIn } from "../render_core.js";
import { strip } from "@delebash/llm-runner/platform/py";
import { construct, CreateLexiconRequest, Lexicon, LexiconEntry, LexiconList, LexiconReach } from "../models.js";

/**
 * A book-scoped lexicon made for a book that has none chosen becomes the book's lexicon
 * (Overview → Pronunciation lexicon), the way an import's does (projects_api._materializeLexicon).
 * Decided 2026-09-30: until then a lexicon made by hand here did nothing until someone found
 * Overview's row. A book that already has one keeps it.
 */
export function _chooseForBookWithNone(projectId, lexiconId) {
  const h = session.getDb();
  const project = h.get(Project, projectId);
  if (project !== null && !project.default_lexicon_id) h.update(Project, { default_lexicon_id: lexiconId }, { id: projectId });
}

/**
 * What a lexicon reaches. The render reads a lexicon in exactly two ways — as a book's (the
 * project's `default_lexicon_id`: every line of that book) and as a persona's (`lexicon_id`: the
 * lines its speakers say, in any book) — so these are the lines an edit to it changes, and the
 * personas whose voices say them. A lexicon nothing reads reaches nothing (its scope only says
 * where it is listed).
 */
export function lexiconReach(lex) {
  const h = session.getDb();
  const projects = h.all(`select id, name from ${Project} where default_lexicon_id = ? order by name`, [lex.id]);
  const own = h.all(`select id, name from ${Persona} where lexicon_id = ? order by name`, [lex.id]);
  const pids = projects.map((p) => p.id);
  const marks = (n) => Array(n).fill("?").join(", ");
  const cast = pids.length
    ? h.all(`select distinct p.id, p.name from ${Speaker} sp join ${Persona} p on p.id = sp.persona_id where sp.project_id in (${marks(pids.length)}) order by p.name`, pids)
    : [];
  const personas = [...new Map([...own, ...cast].map((p) => [p.id, { id: p.id, name: p.name }])).values()];
  // Whole words, any case — the engine's own match (render_core.wordsIn).
  const words = (lex.entries || []).map((e) => e.grapheme).filter((w) => strip(w || ""));
  let lines = 0;
  if (words.length) {
    const texts = new Map();
    if (pids.length) {
      for (const b of h.all(`select b.id, b.text from ${Block} b join ${Scene} s on s.id = b.scene_id where s.project_id in (${marks(pids.length)})`, pids)) texts.set(b.id, b.text);
    }
    const oids = own.map((p) => p.id);
    if (oids.length) {
      for (const b of h.all(`select b.id, b.text from ${Block} b join ${Speaker} sp on sp.id = b.speaker_id where sp.persona_id in (${marks(oids.length)})`, oids)) texts.set(b.id, b.text);
    }
    for (const t of texts.values()) if (wordsIn(t || "", words).size) lines++;
  }
  return { lines, projects: projects.map((p) => ({ id: p.id, name: p.name })), personas };
}

export function router() {
  const app = new Hono();
  app.get("/v1/lexicons", (c) => c.json(construct(LexiconList, { lexicons: getState().lexicons.list() })));

  app.post("/v1/lexicons", input({ body: CreateLexiconRequest }), (c) => {
    const body = c.req.valid("json");
    const lex = getState().lexicons.create(body.name, {
      entries: body.entries,
      scope: body.scope,
      description: body.description,
      project_id: body.project_id,
      persona_id: body.persona_id,
    });
    if (lex.scope === "project" && lex.project_id) _chooseForBookWithNone(lex.project_id, lex.id);
    return c.json(construct(Lexicon, lex), 201);
  });

  app.get("/v1/lexicons/:id", (c) => {
    const id = c.req.param("id");
    const lex = getState().lexicons.get(id);
    if (!lex) throw notFound(`lexicon ${id}`);
    return c.json(construct(Lexicon, lex));
  });

  app.put("/v1/lexicons/:id", input({ body: CreateLexiconRequest }), (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const lex = getState().lexicons.update(id, body.entries, body.name);
    if (!lex) throw notFound(`lexicon ${id}`);
    return c.json(construct(Lexicon, lex));
  });

  app.delete("/v1/lexicons/:id", (c) => {
    const id = c.req.param("id");
    if (!getState().lexicons.delete(id)) throw notFound(`lexicon ${id}`);
    return c.json({ deleted: true });
  });

  app.get("/v1/lexicons/:id/reach", (c) => {
    const id = c.req.param("id");
    const lex = getState().lexicons.get(id);
    if (!lex) throw notFound(`lexicon ${id}`);
    return c.json(construct(LexiconReach, lexiconReach(lex)));
  });

  app.post("/v1/lexicons/:id/entries", input({ body: LexiconEntry }), (c) => {
    const id = c.req.param("id");
    const lex = getState().lexicons.appendEntry(id, c.req.valid("json"));
    if (!lex) throw notFound(`lexicon ${id}`);
    return c.json(construct(Lexicon, lex));
  });
  return app;
}
