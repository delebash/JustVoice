// SPDX-License-Identifier: MIT
// /v1/book_runs — the one-click audiobook's run (the one-click plan's slice 5; book_run.js holds
// it), in render jobs' shape (render_jobs_api.js): start one, poll it, stop it, resume it. A run
// survives a restart as its row ("paused" after the boot sweep).
//
//   GET  /v1/projects/{id}/book_run   what a run would do now (the plan: each step's model, the
//                                     estimate and whether it asks before spending, what stops it)
//                                     and the book's latest run
//   POST /v1/book_runs                start one (`accept_price` when it would send the book to a
//                                     cloud model; `redo` the steps to do again)
//   GET  /v1/book_runs/{id}           where it stands; `?review=true` adds what to check
//   POST /v1/book_runs/{id}/cancel    stop it at the next chapter or line — what is done is kept
//   POST /v1/book_runs/{id}/resume    pick up where it stopped

import { Hono, input } from "@delebash/llm-runner/platform";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import * as bookRun from "../book_run.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { construct, DateTime } from "../models.js";

export const BookRunCreate = T.Object({
  project_id: T.String(),
  scope: opt(literal("project"), "project"),
  // Yes to the price shown before it starts — needed when an AI step runs on a cloud model.
  accept_price: opt(T.Boolean(), false),
  // Steps to do again over what an earlier pass did: discover, analyze, direction, render, check.
  redo: opt(T.Array(T.String()), []),
});

/** Tokens and price an AI step is expected to take (`price` null: a cloud model AI Settings →
 * Pricing has no price for). */
export const BookRunEstimateStep = T.Object({
  tokens_in: T.Integer(),
  tokens_out: T.Integer(),
  price: nullable(T.Number()),
});

export const BookRunEstimate = T.Object({
  tokens_in: T.Integer(),
  tokens_out: T.Integer(),
  price: nullable(T.Number()),
  // Cloud models with no price in AI Settings → Pricing.
  unpriced: opt(T.Array(T.String()), []),
});

/** One step as the plan shows it: what it runs on. `kind`: ai · speech · recognition · file · book. */
export const BookRunPlanStep = T.Object({
  key: T.String(),
  kind: T.String(),
  model: opt(nullable(T.String()), null),
  provider: opt(nullable(T.String()), null),
  cloud: opt(T.Boolean(), false),
  configured: opt(T.Boolean(), true),
  recipe: opt(nullable(T.String()), null),
  // The AI step's feature and prompt row — where AI Settings → Routing by feature changes it.
  feature: opt(nullable(T.String()), null),
  action: opt(nullable(T.String()), null),
  estimate: opt(nullable(BookRunEstimateStep), null),
});

/** Something that stops a run starting (`problems`) or that it will meet (`warnings`). `code`:
 * no_text · no_model · no_language · no_ffmpeg · no_recognition. */
export const BookRunProblem = T.Object({ step: T.String(), code: T.String(), detail: opt(nullable(T.String()), null) });

export const BookRunPlan = T.Object({
  project_id: T.String(),
  chapters: T.Integer(),
  steps: T.Array(BookRunPlanStep),
  estimate: opt(nullable(BookRunEstimate), null),
  ask_price: opt(T.Boolean(), false),
  problems: opt(T.Array(BookRunProblem), []),
  warnings: opt(T.Array(BookRunProblem), []),
});

/** One step of a run: where it stands (`status`: pending · running · done · skipped · failed;
 * `done` of `total` chapters, people, voices or lines; `kept` chapters an earlier pass had done)
 * and what ran (the plan's §5: the model, the recipe, tokens in and out, calls, seconds). */
export const BookRunStep = T.Object({
  key: T.String(),
  status: T.String(),
  done: opt(T.Integer(), 0),
  total: opt(T.Integer(), 0),
  kept: opt(T.Integer(), 0),
  model: opt(nullable(T.String()), null),
  recipe: opt(nullable(T.String()), null),
  tokens_in: opt(T.Integer(), 0),
  tokens_out: opt(T.Integer(), 0),
  calls: opt(T.Integer(), 0),
  seconds: opt(T.Number(), 0),
  note: opt(nullable(T.String()), null),
  error: opt(nullable(T.String()), null),
  // Chapters the step refused (Analyze on a chapter with takes, say) — listed in the review.
  refused: opt(T.Integer(), 0),
  added: opt(nullable(T.Integer()), null),
  made: opt(nullable(T.Integer()), null),
  unmatched: opt(nullable(T.Integer()), null),
  failed: opt(nullable(T.Integer()), null),
  audio_seconds: opt(nullable(T.Number()), null),
  flagged: opt(nullable(T.Integer()), null),
  rerendered: opt(nullable(T.Integer()), null),
  phase: opt(nullable(T.String()), null),
});

const ReviewChapter = T.Object({ scene_id: T.String(), title: T.String(), lines: T.Integer() });
const ReviewTake = T.Object({ scene_id: T.String(), title: T.String(), block_id: T.String(), n: T.Integer(), reasons: T.Array(T.String()) });
const ReviewSpeaker = T.Object({ speaker_id: T.String(), name: T.String(), persona_id: opt(nullable(T.String()), null), lines: opt(nullable(T.Integer()), null) });
const ReviewRefused = T.Object({ step: T.String(), scene_id: T.String(), title: T.String(), reason: T.String() });

/** What to check after a run (book_run.runReview). */
export const BookRunReview = T.Object({
  script: T.Array(ReviewChapter),
  takes: T.Array(ReviewTake),
  voices: T.Array(ReviewSpeaker),
  uncast: T.Array(ReviewSpeaker),
  refused: T.Array(ReviewRefused),
});

export const BookRunOut = T.Object({
  id: T.String(),
  project_id: T.String(),
  scope: T.String(),
  // queued · running · paused (a restart) · cancelled (stopped) · failed · completed
  status: T.String(),
  step: opt(nullable(T.String()), null),
  scene_id: opt(nullable(T.String()), null),
  scene_title: opt(nullable(T.String()), null),
  error: opt(nullable(T.Object({ step: nullable(T.String()), text: T.String() })), null),
  steps: T.Array(BookRunStep),
  totals: T.Object({ tokens_in: T.Integer(), tokens_out: T.Integer(), seconds: T.Number(), price: T.Number() }),
  redo: opt(T.Array(T.String()), []),
  // The estimate shown before it started.
  estimate: opt(nullable(BookRunEstimate), null),
  // The M4B it made, while it waits to be saved (GET /v1/export_jobs/{job_id}/file).
  m4b: opt(nullable(T.Object({ job_id: T.String(), filename: T.String() })), null),
  review: opt(nullable(BookRunReview), null),
  started_at: opt(nullable(DateTime()), null),
  finished_at: opt(nullable(DateTime()), null),
  created_at: opt(nullable(DateTime()), null),
});

export const BookRunState = T.Object({ plan: BookRunPlan, run: opt(nullable(BookRunOut), null) });

const RunParams = T.Object({ run_id: T.String() });

function _found(runId, out) {
  if (out === null) throw notFound(`book run ${runId}`);
  return construct(BookRunOut, out);
}

export function router() {
  const app = new Hono();

  /** What a run of this book would do now, and its latest run. */
  app.get("/v1/projects/:project_id/book_run", async (c) => {
    const h = session.getDb();
    const projectId = c.req.param("project_id");
    const plan = bookRun.planRun(h, projectId);
    const last = bookRun.latestRun(h, projectId);
    let run = null;
    if (last !== null) {
      run = bookRun.runStatus(last.id);
      if (run.status === "completed") run.review = await bookRun.runReview(last.id);
    }
    return c.json(construct(BookRunState, { plan, run }));
  });

  app.post("/v1/book_runs", input({ body: BookRunCreate }), (c) => {
    const body = c.req.valid("json");
    const row = bookRun.createRun(body.project_id, { scope: body.scope, acceptPrice: body.accept_price, redo: body.redo });
    bookRun.startRun(row.id);
    return c.json(construct(BookRunOut, bookRun.runStatus(row.id)));
  });

  app.get("/v1/book_runs/:run_id", input({ params: RunParams, querystring: T.Object({ review: opt(T.Boolean(), false) }) }), async (c) => {
    const runId = c.req.valid("param").run_id;
    const out = bookRun.runStatus(runId);
    if (out !== null && c.req.valid("query").review) out.review = await bookRun.runReview(runId);
    return c.json(_found(runId, out));
  });

  app.post("/v1/book_runs/:run_id/cancel", (c) => {
    const runId = c.req.param("run_id");
    return c.json(_found(runId, bookRun.cancelRun(runId)));
  });

  app.post("/v1/book_runs/:run_id/resume", (c) => {
    const runId = c.req.param("run_id");
    return c.json(_found(runId, bookRun.resumeRun(runId)));
  });
  return app;
}
