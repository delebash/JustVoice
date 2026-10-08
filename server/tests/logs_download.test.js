// SPDX-License-Identifier: MIT
// GET /v1/logs/download — the Settings → Logs download button's target, and the per-day file
// log under the data dir (the port of tests/test_logs_download.py).
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const log = getLogger("justvoice.test");

test("download_serves_ring_as_attachment", async () => {
  const { c } = await appClient();
  log.warning("wiring-audit-w4-marker");
  const r = await c.get("/v1/logs/download");
  expect(r.status).toBe(200);
  expect(r.headers["content-type"].startsWith("text/plain")).toBe(true);
  expect(r.headers["content-disposition"]).toContain("attachment");
  expect(r.headers["content-disposition"]).toContain("justvoice-logs-");
  expect(r.text).toContain("wiring-audit-w4-marker");
});

test("download_matches_tail_content", async () => {
  const { c } = await appClient();
  log.warning("tail-parity-marker");
  const tail = (await c.get("/v1/logs/tail?lines=500")).json().text;
  const download = (await c.get("/v1/logs/download")).text;
  expect(tail).toContain("tail-parity-marker");
  expect(tail).toBe(download);
});

test("file_log_written_at_data_dir", async () => {
  // A per-day file log at {data_dir}/logs/justvoice.log survives the process — the ring dies
  // with a crash, which is exactly when logs are needed.
  const { dir } = await appClient();
  log.warning("file-log-marker");
  const logFile = path.join(dir, "logs", "justvoice.log");
  expect(statSync(logFile).isFile()).toBe(true);
  expect(readFileSync(logFile, "utf8")).toContain("file-log-marker");
});

test("system_info_exposes_data_dir", async () => {
  // Open-log-file in the desktop shell locates the file through /v1/system/info's data_dir.
  const { c, dir } = await appClient();
  const r = (await c.get("/v1/system/info")).json();
  expect(r.data_dir).toBe(dir);
});
