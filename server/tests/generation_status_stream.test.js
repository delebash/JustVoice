// SPDX-License-Identifier: MIT
// The generation-status stream (GET /v1/generate/{id}/status, SSE) reports each status change as it
// happens, ending on a terminal one. A Python bug copied into the port on purpose read the row once,
// so the stream never saw a change after its first frame — the generate page's auto-play and the
// dictation window's agent speech waited out the 10-minute cap (TASKS "The family moves to
// Electron…"; fixed 2026-11-05 as decided 2026-10-08).
import { afterEach, beforeEach, expect, test } from "vitest";
import * as sse from "../src/api/sse_streams_api.js";
import { Generation, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { tmpDb } from "./helpers.js";

let saved;
beforeEach(() => {
  saved = { handle: session.cfg.handle, poll: sse.cfg.SSE_POLL_INTERVAL_S };
  session.cfg.handle = tmpDb();
  sse.cfg.SSE_POLL_INTERVAL_S = 0.01;
});
afterEach(() => {
  session.cfg.handle = saved.handle;
  sse.cfg.SSE_POLL_INTERVAL_S = saved.poll;
});

test("the_stream_sees_the_status_change_and_ends_on_completed", async () => {
  const h = session.getDb();
  const id = uuid();
  h.insert(Generation, { id, text: "hi", engine: "kokoro", status: "running" });
  const frames = [];
  const it = sse._streamGenerationStatus(id);
  frames.push(JSON.parse((await it.next()).value.slice(6)));
  h.update(Generation, { status: "completed", duration_sec: 2.0 }, { id });
  for await (const f of it) frames.push(JSON.parse(f.slice(6)));
  expect(frames.map((f) => f.status)).toEqual(["running", "completed"]);
  expect(frames[1].duration).toBe(2);
});
