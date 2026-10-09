// SPDX-License-Identifier: MIT
// /v1/render_jobs — persistent per-block render jobs (Stage 2 of the 2026-08-08 scheduler work;
// docs/plans/2026-08-08-vram-think.md §7) (the port of justvoice/api/render_jobs_api.py).
//
// Create → the runner drives every block through the SynthScheduler as its own one-item set
// (engine-major grouping, per-block failure isolation) and persists Generation + default Take
// per block exactly like POST /v1/blocks/{id}/render. Poll GET for progress; cancel withdraws
// the queued lines at the next boundary; resume re-runs pending + failed blocks only. Jobs
// survive a server restart as rows ("paused" after the boot sweep).

import { Hono, input } from "@delebash/llm-runner/platform";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { strRepr, ValueError } from "@delebash/llm-runner/platform/py";
import { badRequest, notFound } from "../errors.js";
import { construct } from "../models.js";
import * as renderJobs from "../render_jobs.js";

export const RenderJobCreate = T.Object({
  project_id: T.String(),
  scope: opt(T.String(), "blocks"), // "project" | "scene" | "blocks"
  scope_ids: opt(T.Array(T.String()), []),
});

export const RenderJobBlockOut = T.Object({
  block_id: T.String(),
  status: T.String(),
  generation_id: opt(nullable(T.String()), null),
});

/** A line rendering now: its number in its chapter and its speaker's name. */
export const RenderJobLine = T.Object({
  block_id: T.String(),
  n: opt(nullable(T.Integer()), null),
  speaker: opt(nullable(T.String()), null),
});

/** Work ahead of a waiting job, in the order it runs: whose it is, its kind ("chapter" — a
 * chapter's render; "work" — an export, a preview…), its model. */
export const RenderJobAhead = T.Object({
  label: T.String(),
  kind: T.String(),
  model: opt(nullable(T.String()), null),
  lines: T.Integer(),
});

/** What a job's next line waits behind (2026-10-07) — only while none of its own lines is
 * rendering. */
export const RenderJobWaiting = T.Object({
  lines: T.Integer(),
  groups: opt(T.Array(RenderJobAhead), []),
});

/** The model the line rendering now is loading, and for how long (2026-10-07). */
export const RenderJobLoading = T.Object({
  model: T.String(),
  seconds: T.Number(),
});

export const RenderJobOut = T.Object({
  id: T.String(),
  project_id: T.String(),
  scope: T.String(),
  status: T.String(),
  total_blocks: T.Integer(),
  completed_blocks: T.Integer(),
  failed_blocks: T.Integer(),
  blocks: opt(nullable(T.Array(RenderJobBlockOut)), null),
  // Seconds of audio the finished lines made, and the lines rendering now (2026-10-07).
  audio_seconds: opt(T.Number(), 0.0),
  current: opt(T.Array(RenderJobLine), []),
  waiting: opt(nullable(RenderJobWaiting), null),
  loading: opt(nullable(RenderJobLoading), null),
});

const JobParams = T.Object({ job_id: T.String() });

export function router() {
  const app = new Hono();
  app.post("/v1/render_jobs", input({ body: RenderJobCreate }), (c) => {
    const body = c.req.valid("json");
    if ((body.scope === "scene" || body.scope === "blocks") && !body.scope_ids.length) {
      throw badRequest(`scope_ids is required for scope ${strRepr(body.scope)}`);
    }
    let job;
    try {
      job = renderJobs.createJob(body.project_id, body.scope, body.scope_ids);
    } catch (e) {
      if (e instanceof ValueError) throw badRequest(e.message);
      throw e;
    }
    if (job.total_blocks) renderJobs.startJob(job.id);
    return c.json(construct(RenderJobOut, renderJobs.jobStatus(job.id)));
  });

  app.get(
    "/v1/render_jobs/:job_id",
    input({ params: JobParams, querystring: T.Object({ include_blocks: opt(T.Boolean(), false) }) }),
    (c) => {
      const jobId = c.req.valid("param").job_id;
      const out = renderJobs.jobStatus(jobId, { includeBlocks: c.req.valid("query").include_blocks });
      if (out === null) throw notFound(`render job ${jobId}`);
      return c.json(construct(RenderJobOut, out));
    },
  );

  app.post("/v1/render_jobs/:job_id/cancel", (c) => {
    const jobId = c.req.param("job_id");
    const out = renderJobs.cancelJob(jobId);
    if (out === null) throw notFound(`render job ${jobId}`);
    return c.json(construct(RenderJobOut, out));
  });

  app.post("/v1/render_jobs/:job_id/resume", (c) => {
    const jobId = c.req.param("job_id");
    const out = renderJobs.resumeJob(jobId);
    if (out === null) throw notFound(`render job ${jobId}`);
    return c.json(construct(RenderJobOut, out));
  });
  return app;
}
