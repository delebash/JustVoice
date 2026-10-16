// SPDX-License-Identifier: MIT
// Render's line page and chapter grid (Studio Slice 4, decided 2026-10-04;
// docs/plans/2026-10-04-slice-4-render.md) (the port of justvoice/api/render_lines_api.py).
//
// - GET  /v1/scenes/{id}/render_lines — a chapter's heard lines, each with its state in §8.16's
//   words, its ★ take and how many takes it has, and the render job running over them.
// - GET  /v1/projects/{id}/render_state — every chapter's counts: Render's grid, Studio's step
//   card, Overview and Home — and each chapter's running render job.
// - POST /v1/scenes/{id}/render_lines — render a chapter's lines as a render job: "ready" (each
//   line with no take gets one — ⚡ Render N ready, a chapter's ▶ Render) or "all" (a new take
//   for every line that can render, past the render cache — ↻ Re-render all).
// - POST /v1/scenes/{id}/check_takes — check a chapter's takes: read back, a failed take
//   rendered again once, what still fails flagged (take_check.js, the one-click plan's slice 6).
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
import * as takeCheck from "../take_check.js";
import { clientGone } from "./generate_api.js";
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

/** What the take check found about a take (take_check.js, 2026-10-16) — the record kept in the
 * line's metadata. `reasons`: "runaway" (longer than its text allows), "missed" (the read-back
 * misses its words), "extra" (the read-back hears words past them), "rerender_failed". */
export const TakeCheck = T.Object({
  generation_id: T.String(),
  ok: opt(T.Boolean(), false),
  flagged: opt(T.Boolean(), false),
  reasons: opt(T.Array(T.String()), []),
  heard: opt(nullable(T.String()), null),
  // The line's words, and the read-back's missed and extra ones — null when the take ran away
  // and was not read back (`heard` null too).
  words: opt(T.Integer(), 0),
  missed: opt(nullable(T.Integer()), null),
  extra: opt(nullable(T.Integer()), null),
  seconds: opt(nullable(T.Number()), null),
  limit_s: opt(nullable(T.Number()), null),
  retry_of: opt(nullable(T.String()), null),
  recogniser: opt(nullable(T.String()), null),
  checked_at: opt(nullable(T.String()), null),
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
  // The take check's finding about the take in use, when it was checked (2026-10-16).
  check: opt(nullable(TakeCheck), null),
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
  // The render job running over this chapter's lines, wherever it was started — Render follows
  // it (2026-10-13, the narrowings review R3; render_jobs.runningJobsByScene).
  running_job: opt(nullable(RenderJobOut), null),
});

// pydantic puts a subclass's own fields after its base's.
export const ChapterRenderState = T.Object({
  ...COUNTS,
  scene_id: T.String(),
  title: T.String(),
  running_job: opt(nullable(RenderJobOut), null),
});

export const ProjectRenderState = T.Object({
  project_id: T.String(),
  chapters: T.Array(ChapterRenderState),
  totals: RenderCounts,
});

export const RenderLinesRequest = T.Object({ which: opt(literal("ready", "all"), "ready") });

export const BookLexicon = T.Object({ lexicon_id: T.String(), name: T.String(), created: T.Boolean() });

/** `redo`: judge every take in use again, past what an earlier check found. */
export const CheckTakesRequest = T.Object({ redo: opt(T.Boolean(), false) });

export const CheckedLine = T.Object({
  block_id: T.String(),
  scene_id: T.String(),
  n: T.Integer(),
  check: TakeCheck,
});

export const CheckTakesError = T.Object({ block_id: T.String(), error: T.String() });

/** What one run of the take check did (take_check.checkTakes): takes read back, lines that
 * passed, were rendered again once, or are flagged; lines already judged (skipped) and lines with
 * no take made from what they are now (unchecked); the lines it judged, each with its finding. */
export const CheckTakesOut = T.Object({
  scene_ids: T.Array(T.String()),
  recogniser: opt(nullable(T.String()), null),
  checked: T.Integer(),
  passed: T.Integer(),
  rerendered: T.Integer(),
  flagged: T.Integer(),
  skipped: T.Integer(),
  unchecked: T.Integer(),
  errors: opt(T.Array(CheckTakesError), []),
  lines: opt(T.Array(CheckedLine), []),
  stopped: opt(T.Boolean(), false),
});

export function router() {
  const app = new Hono();
  app.get("/v1/scenes/:scene_id/render_lines", async (c) => {
    const h = _openDb();
    const page = await lineTakes.sceneLines(h, getState(), c.req.param("scene_id"));
    page.running_job = renderJobs.runningJobsByScene(h, [page.scene_id]).get(page.scene_id) ?? null;
    return c.json(construct(SceneRenderLines, page));
  });

  app.get("/v1/projects/:project_id/render_state", async (c) => {
    const h = _openDb();
    const projectId = c.req.param("project_id");
    if (h.one(`select id from ${Project} where id = ? limit 1`, [projectId]) === null) throw notFound(`project ${projectId}`);
    const out = await lineTakes.projectRenderState(h, getState(), projectId);
    const running = renderJobs.runningJobsByScene(h, out.chapters.map((ch) => ch.scene_id));
    for (const ch of out.chapters) ch.running_job = running.get(ch.scene_id) ?? null;
    return c.json(construct(ProjectRenderState, out));
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
   * Check a chapter's takes (the one-click plan's slice 6, 2026-10-16; take_check.js): each take
   * in use read back by the app's speech recognition, a failed one rendered again once with a
   * new seed, one that still fails flagged in its line's metadata. Answers when the check is
   * done, re-render included; leaving early stops it at the next line.
   */
  app.post("/v1/scenes/:scene_id/check_takes", input({ body: nullable(CheckTakesRequest) }), async (c) => {
    const redo = Boolean(c.req.valid("json")?.redo);
    const h = _openDb();
    const sceneId = c.req.param("scene_id");
    if (h.one(`select id from ${Scene} where id = ? limit 1`, [sceneId]) === null) throw notFound(`scene ${sceneId}`);
    const out = await takeCheck.checkTakes(getState(), [sceneId], { redo, signal: clientGone(c) });
    return c.json(construct(CheckTakesOut, out));
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
