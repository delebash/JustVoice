// SPDX-License-Identifier: MIT
// Server-sent event streams — per-generation status + per-model download (the port of
// justvoice/api/sse_streams_api.py).
//
// Subscribed by: useGenerationProgress (auto-play on complete + history invalidation),
// useModelDownloadToast (toast progress bar tied to download), DictateWindow's agent-speak cycle
// (MCP justvoice.speak playback).

import { Hono, stream } from "@delebash/llm-runner/platform";
import { sleep } from "@delebash/llm-runner/platform/asyncutil";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Generation } from "../database/models.js";
import * as session from "../database/session.js";

export const cfg = {
  SSE_POLL_INTERVAL_S: 0.5,
  SSE_TIMEOUT_S: 600, // 10 min hard cap on any single subscription
};

const frame = (obj, floats) => `data: ${pyJson(obj, { floats })}\n\n`;

/**
 * Poll the generation status until it terminates (completed/failed/cancelled) or the timeout
 * fires. Yields SSE text frames. Terminal statuses: completed / failed / cancelled / not_found.
 *
 * Python's bug, copied on purpose: the loop re-queried through ONE SQLAlchemy session, whose
 * identity map hands back the row object it loaded first without refreshing it — so the
 * stream never sees a status change after its first frame (measured: a row updated from
 * another session still reads its first status), only the row's deletion (the query then
 * finds nothing). The row is therefore read once and only its existence re-checked.
 */
export async function* _streamGenerationStatus(generationId) {
  const h = session.getDb();
  let elapsed = 0.0;
  let lastStatus = null;
  let loaded = null; // the identity map's copy
  while (elapsed < cfg.SSE_TIMEOUT_S) {
    let gen = h.one(`select * from ${Generation} where id = ? limit 1`, [generationId], Generation);
    if (gen !== null) {
      if (loaded === null) loaded = gen;
      gen = loaded;
    }
    if (gen === null) {
      yield frame({ id: generationId, status: "not_found" });
      return;
    }
    const status = gen.status;
    if (status !== lastStatus) {
      // duration_sec is a Float column: Python wrote it as a float (`2.0`).
      yield frame({ id: gen.id, status, duration: gen.duration_sec, error: gen.error, source: gen.source }, ["duration"]);
      lastStatus = status;
    }
    if (status === "completed" || status === "failed" || status === "cancelled") return;
    await sleep(cfg.SSE_POLL_INTERVAL_S * 1000);
    elapsed += cfg.SSE_POLL_INTERVAL_S;
  }
}

/** Python polled an in-process progress manager (`..utils.progress`) that was never written:
 * its import fails, so every subscription answers this one frame. */
export async function* _streamModelDownload(modelName) {
  yield frame({ model_name: modelName, status: "error", error: "progress manager unavailable" });
}

/**
 * Starlette's StreamingResponse with `media_type="text/event-stream"` and `headers` (these
 * routes' own by default), fed by an async iterable of text frames; stops pulling when the
 * client goes. `onAbort` runs when the client goes away mid-stream (extraction's streams stop
 * their work then). Candidate for platform/ (the API wave's other streams use it).
 *
 * The kit's `stream` (Hono's), not `streamSSE`, which adds headers of its own: Starlette sent
 * the content type and the route's headers only. Headers a middleware already set on `c` ride
 * along. The status and headers go out as the stream starts, before its first frame
 * (@hono/node-server flushes them, as uvicorn wrote `http.response.start` at once): a client
 * then knows the stream started — and can cancel it — while the first frame is still being made
 * (measured with Analyze's stream on a slow model, 2026-10-08).
 */
export function sseResponse(c, gen, headers = { "cache-control": "no-cache", "x-accel-buffering": "no" }, { onAbort = null } = {}) {
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  c.header("content-type", "text/event-stream; charset=utf-8");
  return stream(c, async (s) => {
    let closed = false;
    s.onAbort(() => {
      closed = true;
      onAbort?.();
    });
    for await (const text of gen) {
      if (closed) break;
      await s.write(text);
    }
  });
}

export function router() {
  const app = new Hono();
  app.get("/v1/generate/:generation_id/status", (c) => sseResponse(c, _streamGenerationStatus(c.req.param("generation_id"))));

  app.get("/v1/models/progress/:model_name", (c) => sseResponse(c, _streamModelDownload(c.req.param("model_name"))));
  return app;
}
