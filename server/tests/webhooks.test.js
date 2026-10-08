// SPDX-License-Identifier: MIT
// Webhooks — the HMAC signature contract + storage round-trip, plus the background
// dispatcher's delivery bookkeeping + retry ladder (HTTP faked, the backoff zeroed so the ladder
// runs at once). The port of tests/test_webhooks.py.
import { createHmac } from "node:crypto";
import * as http from "@delebash/llm-runner/platform/http";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { afterEach, expect, test, vi } from "vitest";
import * as whApi from "../src/api/webhooks_api.js";
import { Webhook } from "../src/database/models.js";
import { jsonLoads } from "../src/py_compat.js";
import { tmpDb } from "./helpers.js";

const { _hashSecret } = whApi;
const saved = { ...whApi.cfg };

afterEach(() => {
  Object.assign(whApi.cfg, saved);
});

test("hash_secret_is_deterministic", () => {
  const h1 = _hashSecret("topsecret");
  const h2 = _hashSecret("topsecret");
  const h3 = _hashSecret("different");
  expect(h1).toBe(h2);
  expect(h1).not.toBe(h3);
});

test("webhook_round_trip", () => {
  const h = tmpDb();
  h.insert(Webhook, {
    url: "https://example.com/hook",
    events_json: pyJson(["render.completed", "render.failed"]),
    secret_hash: _hashSecret("s"),
    enabled: true,
  });
  const fetched = h.one(`select * from ${Webhook} limit 1`, undefined, Webhook);
  expect(fetched.url).toBe("https://example.com/hook");
  expect(jsonLoads(fetched.events_json)).toEqual(["render.completed", "render.failed"]);
  expect(fetched.enabled).toBe(true);
});

test("hmac_signature_format", () => {
  // X-JustVoice-Signature = hex(hmac_sha256(secret, body)): the canonical computation the
  // dispatcher emits.
  const body = Buffer.from(pyJson({ event: "render.completed", data: { id: "abc" } }), "utf8");
  const expected = createHmac("sha256", "s3cret").update(body).digest("hex");
  expect(expected.length).toBe(64); // SHA-256 hex = 64 chars
  expect(/^[0-9a-f]+$/.test(expected)).toBe(true);
});

// ── Background dispatcher: bookkeeping + retry ladder ─────────────────────

function seedWebhook(h, wid = "wh-1") {
  h.insert(Webhook, {
    id: wid,
    url: "https://example.com/hook",
    events_json: pyJson(["render.completed"]),
    secret_hash: _hashSecret("s"),
    enabled: true,
  });
  return wid;
}

/** Point the dispatcher at the test database, zero the backoff, script the HTTP outcomes (a
 * status → a response; an Error → thrown). Returns the shared call counter. */
function patchDelivery(h, statuses) {
  const calls = { n: 0 };
  whApi.cfg.SessionLocal = h;
  whApi.cfg.waitLadder = () => 0;
  vi.spyOn(http, "fetch").mockImplementation(async () => {
    const val = statuses[Math.min(calls.n, statuses.length - 1)];
    calls.n += 1;
    if (val instanceof Error) throw val;
    return { status: val, arrayBuffer: async () => new ArrayBuffer(0) };
  });
  return calls;
}

const fetchRow = (h, wid) => h.one(`select * from ${Webhook} where id = ?`, [wid], Webhook);

test("background_failure_recorded_and_ladder_retries", async () => {
  // A persistently-failing endpoint: all 5 attempts fire (first + the [1,5,30,300] ladder) and
  // EVERY failure is recorded.
  const h = tmpDb();
  const wid = seedWebhook(h);
  const calls = patchDelivery(h, [500]);
  await whApi._deliverWithRetry(wid, "https://example.com/hook", "render.completed", { k: "v" });
  expect(calls.n).toBe(5); // 1 + len(_RETRY_DELAYS_S)
  const wh = fetchRow(h, wid);
  expect(wh.last_status_code).toBe(500);
  expect(wh.last_delivery_at).not.toBeNull();
  const tail = jsonLoads(wh.log_tail_json);
  expect(tail.length).toBe(5);
  expect(tail.every((e) => e.status === 500 && e.error === "HTTP 500")).toBe(true);
});

test("background_success_records_once", async () => {
  const h = tmpDb();
  const wid = seedWebhook(h);
  const calls = patchDelivery(h, [200]);
  await whApi._deliverWithRetry(wid, "https://example.com/hook", "render.completed", { k: "v" });
  expect(calls.n).toBe(1); // 2xx → no retry
  const wh = fetchRow(h, wid);
  expect(wh.last_status_code).toBe(200);
  const tail = jsonLoads(wh.log_tail_json);
  expect(tail.length).toBe(1);
  expect(tail[0].status).toBe(200);
  expect(tail[0]).not.toHaveProperty("error");
});

test("background_recovers_on_second_attempt", async () => {
  const h = tmpDb();
  const wid = seedWebhook(h);
  const calls = patchDelivery(h, [503, 200]);
  await whApi._deliverWithRetry(wid, "https://example.com/hook", "render.completed", { k: "v" });
  expect(calls.n).toBe(2); // fail, then succeed
  const wh = fetchRow(h, wid);
  expect(wh.last_status_code).toBe(200); // the final success wins
  expect(jsonLoads(wh.log_tail_json).map((e) => e.status)).toEqual([503, 200]);
});

test("background_transport_exception_recorded", async () => {
  // Network/transport errors (no HTTP status) also record — status null, the exception summary
  // in the log tail — and retry the full ladder.
  const h = tmpDb();
  const wid = seedWebhook(h);
  const boom = new Error("boom");
  boom.name = "ConnectError";
  const calls = patchDelivery(h, [boom]);
  await whApi._deliverWithRetry(wid, "https://example.com/hook", "render.completed", { k: "v" });
  expect(calls.n).toBe(5);
  const wh = fetchRow(h, wid);
  expect(wh.last_status_code).toBeNull();
  const tail = jsonLoads(wh.log_tail_json);
  expect(tail.length).toBe(5);
  expect(tail.every((e) => e.error.includes("ConnectError"))).toBe(true);
});

test("log_tail_capped_at_50", async () => {
  // The rolling tail never grows past the cap, across many deliveries.
  const h = tmpDb();
  const wid = seedWebhook(h);
  patchDelivery(h, [200]);
  for (let i = 0; i < whApi._LOG_TAIL_CAP + 10; i++) {
    await whApi._deliverWithRetry(wid, "https://example.com/hook", "render.completed", { k: "v" });
  }
  expect(jsonLoads(fetchRow(h, wid).log_tail_json).length).toBe(whApi._LOG_TAIL_CAP);
});
