// SPDX-License-Identifier: MIT
// /v1/active_tasks — page-refresh recovery for in-flight work (the port of
// justvoice/api/active_tasks_api.py).
//
// Polled every 30s by the renderer's useRestoreActiveTasks hook. Returns the current set of
// pending generations + active model downloads so the UI can re-attach progress toasts after a
// window close+reopen or page refresh.

import { Hono } from "@delebash/llm-runner/platform";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { Generation } from "../database/models.js";
import * as session from "../database/session.js";
import { construct, DateTime } from "../models.js";

export const ActiveGeneration = T.Object({
  task_id: T.String(), // the generation.id
  profile_id: nullable(T.String()),
  text_preview: T.String(), // first 80 chars
  status: T.String(),
  created_at: DateTime(),
});

export const ActiveDownloadTask = T.Object({
  model_name: T.String(),
  display_name: T.String(),
  status: T.String(), // "downloading" | "extracting" | "complete" | "error"
  progress: opt(T.Number(), 0.0), // 0..100
  current: opt(T.Integer(), 0),
  total: opt(T.Integer(), 0),
});

export const ActiveTasksResponse = T.Object({
  generations: T.Array(ActiveGeneration),
  downloads: T.Array(ActiveDownloadTask),
});

/** Python's `(g.text or "")[:80]` — 80 code points. */
const head80 = (s) => [...(s || "")].slice(0, 80).join("");

export function router() {
  const app = new Hono();
  app.get("/v1/active_tasks", (c) => {
    const h = session.getDb();
    // Pending generations: anything not terminal.
    const pending = h.all(
      `select * from ${Generation} where status in ('queued', 'loading_model', 'generating') order by created_at desc limit 100`,
      undefined,
      Generation,
    );
    const generations = pending.map((g) => ({
      task_id: g.id,
      profile_id: g.profile_id,
      text_preview: head80(g.text),
      status: g.status,
      created_at: g.created_at,
    }));
    // Active downloads came from an in-process progress manager (`..utils.progress`) that was
    // never written: Python's import fails and the list is always empty.
    return c.json(construct(ActiveTasksResponse, { generations, downloads: [] }));
  });
  return app;
}
