// SPDX-License-Identifier: MIT
// /v1/lexicons CRUD (the port of justvoice/api/lexicons_api.py).

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

export async function router(app) {
  app.get("/v1/lexicons", async () => construct(LexiconList, { lexicons: getState().lexicons.list() }));

  app.post("/v1/lexicons", { schema: { body: CreateLexiconRequest } }, async (req, reply) => {
    const body = req.body;
    const lex = getState().lexicons.create(body.name, {
      entries: body.entries,
      scope: body.scope,
      description: body.description,
      project_id: body.project_id,
      persona_id: body.persona_id,
    });
    if (lex.scope === "project" && lex.project_id) _chooseForBookWithNone(lex.project_id, lex.id);
    reply.code(201);
    return construct(Lexicon, lex);
  });

  app.get("/v1/lexicons/:id", async (req) => {
    const lex = getState().lexicons.get(req.params.id);
    if (!lex) throw notFound(`lexicon ${req.params.id}`);
    return construct(Lexicon, lex);
  });

  app.put("/v1/lexicons/:id", { schema: { body: CreateLexiconRequest } }, async (req) => {
    const lex = getState().lexicons.update(req.params.id, req.body.entries, req.body.name);
    if (!lex) throw notFound(`lexicon ${req.params.id}`);
    return construct(Lexicon, lex);
  });

  app.delete("/v1/lexicons/:id", async (req) => {
    if (!getState().lexicons.delete(req.params.id)) throw notFound(`lexicon ${req.params.id}`);
    return { deleted: true };
  });

  app.post("/v1/lexicons/:id/entries", { schema: { body: LexiconEntry } }, async (req) => {
    const lex = getState().lexicons.appendEntry(req.params.id, req.body);
    if (!lex) throw notFound(`lexicon ${req.params.id}`);
    return construct(Lexicon, lex);
  });
}
