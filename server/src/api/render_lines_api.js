// SPDX-License-Identifier: MIT
// Render's line page and chapter grid (Studio Slice 4, decided 2026-10-04;
// docs/plans/2026-10-04-slice-4-render.md) (the port of justvoice/api/render_lines_api.py).
//
// - GET  /v1/scenes/{id}/render_lines — a chapter's heard lines, each with its state in §8.16's
//   words, its ★ take and how many takes it has.
// - GET  /v1/projects/{id}/render_state — every chapter's counts: Render's grid, Studio's step
//   card, Overview and Home.
// - POST /v1/scenes/{id}/render_lines — render a chapter's lines as a render job: "ready" (each
//   line with no take gets one — ⚡ Render N ready, a chapter's ▶ Render) or "all" (a new take
//   for every line that can render, past the render cache — ↻ Re-render all).
// - POST /v1/projects/{id}/lexicon — the book's lexicon for 📕 Pronunciation, made ("<book>
//   names") and chosen for the book when it has none.
//
// The rules — what a take was made from, stale, the line's own numbers — live in line_takes.js.

import { Hono, input } from "@delebash/llm-runner/platform";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { ValueError } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { Project, Scene } from "../database/models.js";
import * as session from "../database/session.js";
import { badRequest, internal, notFound } from "../errors.js";
import * as lineTakes from "../line_takes.js";
import { construct } from "../models.js";
import * as renderJobs from "../render_jobs.js";
import { RenderJobOut } from "./render_jobs_api.js";

/** The app's database; Python's `_open_db` (internal error before boot). */
function _openDb() {
  if (session.cfg.handle === null) throw internal("database not initialized");
  return session.cfg.handle;
}

export const LineTake = T.Object({
  take_id: T.String(),
  generation_id: T.String(),
  seconds: opt(nullable(T.Number()), null),
  audio_url: opt(nullable(T.String()), null),
  label: opt(nullable(T.String()), null),
  new_seed: opt(T.Boolean(), false),
  text: opt(nullable(T.String()), null),
});

export const RenderLine = T.Object({
  block_id: T.String(),
  n: T.Integer(),
  text: T.String(),
  speaker_id: opt(nullable(T.String()), null),
  spoken: opt(T.Boolean(), false),
  direction: opt(T.String(), ""),
  // What the line sets for itself (This line only): speed, pitch, gain_db, pause_after_ms — set
  // ones only — and `models`: {model: {knobs, emotion, register_tag}} (2026-10-06).
  override: opt(T.Record(T.String(), T.Any()), {}),
  // The line ends one of the book's scenes (line_takes.sceneEnds): with no pause of its own,
  // Settings' pause at a scene break follows it (2026-10-06).
  scene_end: opt(T.Boolean(), false),
  // The next line is from the same paragraph (line_takes.paragraphJoins): with no pause of its
  // own, Settings' pause within a paragraph follows it (2026-10-07).
  paragraph_next: opt(T.Boolean(), false),
  state: literal("needs a speaker", "needs a voice", "ready", "rendered", "stale"),
  takes: opt(T.Integer(), 0),
  live: opt(nullable(LineTake), null),
});

const COUNTS = {
  lines: opt(T.Integer(), 0),
  needs_speaker: opt(T.Integer(), 0),
  needs_voice: opt(T.Integer(), 0),
  ready: opt(T.Integer(), 0),
  rendered: opt(T.Integer(), 0),
  stale: opt(T.Integer(), 0),
};

export const RenderCounts = T.Object(COUNTS);

export const SceneRenderLines = T.Object({
  scene_id: T.String(),
  title: T.String(),
  position: T.Integer(),
  lines: T.Array(RenderLine),
  counts: RenderCounts,
});

// pydantic puts a subclass's own fields after its base's.
export const ChapterRenderState = T.Object({ ...COUNTS, scene_id: T.String(), title: T.String() });

export const ProjectRenderState = T.Object({
  project_id: T.String(),
  chapters: T.Array(ChapterRenderState),
  totals: RenderCounts,
});

export const RenderLinesRequest = T.Object({ which: opt(literal("ready", "all"), "ready") });

export const BookLexicon = T.Object({ lexicon_id: T.String(), name: T.String(), created: T.Boolean() });

export function router() {
  const app = new Hono();
  app.get("/v1/scenes/:scene_id/render_lines", async (c) =>
    c.json(construct(SceneRenderLines, await lineTakes.sceneLines(_openDb(), getState(), c.req.param("scene_id")))),
  );

  app.get("/v1/projects/:project_id/render_state", async (c) => {
    const h = _openDb();
    const projectId = c.req.param("project_id");
    if (h.one(`select id from ${Project} where id = ? limit 1`, [projectId]) === null) throw notFound(`project ${projectId}`);
    return c.json(construct(ProjectRenderState, await lineTakes.projectRenderState(h, getState(), projectId)));
  });

  /**
   * A render job over a chapter's lines (G2: every line it renders gets a take). "ready": the
   * lines with no take. "all": every line that can render, past the render cache. Lines that
   * can't render are left out — Render shows them, and the chapter's ▶ Render refuses until
   * they can.
   */
  app.post("/v1/scenes/:scene_id/render_lines", input({ body: nullable(RenderLinesRequest) }), async (c) => {
    const which = (c.req.valid("json") ?? construct(RenderLinesRequest, {})).which;
    const h = _openDb();
    const sceneId = c.req.param("scene_id");
    const scene = h.one(`select * from ${Scene} where id = ? limit 1`, [sceneId], Scene);
    if (scene === null) throw notFound(`scene ${sceneId}`);
    const projectId = scene.project_id;
    const page = await lineTakes.sceneLines(h, getState(), sceneId);
    const wanted = which === "ready" ? ["ready"] : ["ready", "rendered", "stale"];
    const ids = page.lines.filter((line) => wanted.includes(line.state)).map((line) => line.block_id);
    let job;
    try {
      job = renderJobs.createJob(projectId, "blocks", ids, { fresh: which === "all" });
    } catch (e) {
      if (e instanceof ValueError) throw badRequest(e.message);
      throw e;
    }
    if (job.total_blocks) renderJobs.startJob(job.id);
    return c.json(construct(RenderJobOut, renderJobs.jobStatus(job.id)));
  });

  /**
   * The book's lexicon — 📕 Pronunciation opens it (decided 2026-09-30, project-lexicon §6
   * item 4). A book with none gets "<book> names", chosen as its lexicon (Overview →
   * Pronunciation lexicon).
   */
  app.post("/v1/projects/:project_id/lexicon", (c) => {
    const st = getState();
    const h = _openDb();
    const projectId = c.req.param("project_id");
    const project = h.one(`select * from ${Project} where id = ? limit 1`, [projectId], Project);
    if (project === null) throw notFound(`project ${projectId}`);
    if (project.default_lexicon_id) {
      const lex = st.lexicons.get(project.default_lexicon_id);
      if (lex !== null) return c.json(construct(BookLexicon, { lexicon_id: lex.id, name: lex.name, created: false }));
    }
    const lex = st.lexicons.create(`${project.name} names`, { scope: "project", project_id: projectId });
    h.update(Project, { default_lexicon_id: lex.id }, { id: projectId });
    return c.json(construct(BookLexicon, { lexicon_id: lex.id, name: lex.name, created: true }));
  });
  return app;
}
