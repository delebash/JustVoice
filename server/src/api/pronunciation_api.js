// SPDX-License-Identifier: MIT
// /v1/projects/{id}/pronunciation-report — the pre-flight name scan (C2) (the port of
// justvoice/api/pronunciation_api.py).
//
// Walks every block of the project, finds likely proper nouns (pronunciation.js), subtracts
// what the render already handles on each line, and returns the worklist. The Lexicons page's
// "Scan a book" button is the consumer: one click turns "discover the mispronounced name in
// chapter 30 of the finished audiobook" into a list you fix before rendering.
//
// "Handled" is read per line, with the lexicons the render reads that line with
// (render_core.lineLexicons — the book's chosen lexicon, then the persona's that speaks the
// line), since 2026-09-30. It used to count every book-scoped lexicon of the project, chosen or
// not, while the render read none of them: a name could be "handled" and still be said wrong.

import { Block, LexiconEntry, Persona, Project, Scene, Speaker } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { scanNames } from "../pronunciation.js";
import { lineLexicons } from "../render_core.js";

const marks = (n) => Array(n).fill("?").join(", ");

export async function router(app) {
  /** Likely-mispronounced names the render doesn't already handle. */
  app.post("/v1/projects/:project_id/pronunciation-report", async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    const project = h.one(`select * from ${Project} where id = ? limit 1`, [projectId], Project);
    if (project === null) throw notFound(`project '${projectId}' not found`);

    const blocks = h.all(
      `select ${Block}.text, ${Block}.speaker_id from ${Block} join ${Scene} on ${Block}.scene_id = ${Scene}.id ` +
        `where ${Scene}.project_id = ? order by ${Scene}.position, ${Block}.position`,
      [projectId],
    );

    // line → speaker → persona → its lexicon, the render's own chain.
    const personaOf = new Map(h.all(`select id, persona_id from ${Speaker} where project_id = ?`, [projectId]).map((r) => [r.id, r.persona_id]));
    const cast = [...new Set([...personaOf.values()].filter(Boolean))];
    const lexiconOf = new Map(
      cast.length ? h.all(`select id, lexicon_id from ${Persona} where id in (${marks(cast.length)})`, cast).map((r) => [r.id, r.lexicon_id]) : [],
    );

    // A row counts as handled even while its pronunciation is blank — the scan's job is
    // "which names have no row yet".
    const wordsIn = new Map();
    const covered = (lexiconIds) => {
      const out = new Set();
      for (const lid of lexiconIds) {
        if (!wordsIn.has(lid)) {
          wordsIn.set(lid, new Set(h.all(`select word from ${LexiconEntry} where lexicon_id = ?`, [lid]).map((r) => r.word)));
        }
        for (const w of wordsIn.get(lid)) out.add(w);
      }
      return out;
    };

    const lines = blocks.map((b) => [
      b.text,
      covered(lineLexicons(project.default_lexicon_id, lexiconOf.get(personaOf.get(b.speaker_id)) ?? null)),
    ]);

    const words = scanNames(lines);
    const all = new Set();
    for (const s of wordsIn.values()) for (const w of s) all.add(w);
    return {
      project_id: projectId,
      project_name: project.name,
      blocks_scanned: lines.length,
      covered_count: all.size,
      words,
    };
  });
}
