// SPDX-License-Identifier: MIT
// /v1/lexicons CRUD (the port of justvoice/api/lexicons_api.py).

import { Hono, input } from "@delebash/llm-runner/platform";
import { getState } from "../app_state.js";
import { Project } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { construct, CreateLexiconRequest, Lexicon, LexiconEntry, LexiconList } from "../models.js";

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

  app.post("/v1/lexicons/:id/entries", input({ body: LexiconEntry }), (c) => {
    const id = c.req.param("id");
    const lex = getState().lexicons.appendEntry(id, c.req.valid("json"));
    if (!lex) throw notFound(`lexicon ${id}`);
    return c.json(construct(Lexicon, lex));
  });
  return app;
}
