// SPDX-License-Identifier: MIT
// /v1/webhooks — outbound HTTP webhooks with HMAC-SHA256 signed bodies (the port of
// justvoice/api/webhooks_api.py).
//
// Delivery: at-least-once with exponential backoff (1s, 5s, 30s, 5m, max 4 retries — 5
// attempts). Signature header `X-JustVoice-Signature: hex(hmac_sha256(secret, body))`. Every
// delivery attempt is logged to a rolling log_tail (capped 50 entries). See DESIGN_FREEZE.md
// §4.12 + §5 webhooks workflow.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { sleep } from "@delebash/llm-runner/platform/asyncutil";
import { RequestValidationError } from "@delebash/llm-runner/platform/errors";
import * as http from "@delebash/llm-runner/platform/http";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { isDict } from "@delebash/llm-runner/platform/py";
import { jsonLoads, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Webhook, uuid } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { construct, DateTime, utcNowNaive } from "../models.js";
import * as self from "./webhooks_api.js";

export const WEBHOOK_EVENTS = [
  "render.completed",
  "render.failed",
  "generation.created",
  "voice.created",
  "model.download.completed",
  "model.download.failed",
  "webhook.test",
];
export const WebhookEvent = literal(...WEBHOOK_EVENTS);

export const WebhookSubscription = T.Object({
  id: T.String(),
  url: T.String(),
  events: T.Array(WebhookEvent),
  secret_set: opt(T.Boolean(), true),
  enabled: T.Boolean(),
  created_at: DateTime(),
  last_delivery_at: nullable(DateTime()),
  last_status_code: nullable(T.Integer()),
});

export const WebhookList = T.Object({ subscriptions: T.Array(WebhookSubscription) });

export const CreateWebhookRequest = T.Object({
  url: T.String(), // pydantic's HttpUrl — checked by `httpUrl` below
  events: T.Array(WebhookEvent),
  secret: opt(nullable(T.String({ minLength: 8, maxLength: 256 })), null),
  enabled: opt(T.Boolean(), true),
});

export const WebhookWithSecret = T.Object({
  subscription: WebhookSubscription,
  secret: T.String(), // returned ONCE
});

export const WebhookTestResult = T.Object({
  delivered: T.Boolean(),
  status_code: nullable(T.Integer()),
  latency_ms: nullable(T.Integer()),
  error: nullable(T.String()),
});

/**
 * `cfg.SessionLocal`: the detached dispatcher's database (null = the app's; a test points it at
 * its own). `cfg.waitLadder(i)`: the seconds to wait before retry i (tenacity's wait chain; a
 * test zeroes it).
 */
export const cfg = {
  SessionLocal: null,
  waitLadder: (i) => {
    const s = _RETRY_DELAYS_S[Math.min(i, _RETRY_DELAYS_S.length - 1)];
    // a touch of proportional jitter so a fleet of webhooks pointed at one downed endpoint
    // doesn't retry in lockstep (wait_fixed(s) + wait_random(0, max(1, s * 0.1)))
    return s + Math.random() * Math.max(1.0, s * 0.1);
  },
};

// In-process secret cache. The secret is hashed for storage, but the dispatcher needs the raw
// secret to sign payloads — so raw secrets stay in memory after creation. On server restart the
// operator must rotate them.
export const _SECRETS_CACHE = new Map();

export const _hashSecret = (raw) => createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex");

/** `secrets.token_urlsafe(32)`. */
const tokenUrlsafe = (n) => randomBytes(n).toString("base64url");

/**
 * pydantic 2's `HttpUrl`: at most 2083 characters, a URL the WHATWG/`url`-crate parser reads,
 * scheme http or https; `str()` is the normalised form (lower-case scheme and host, a "/" for
 * an empty path, default port dropped). Throws the 422 pydantic gives at body.url.
 */
export function httpUrl(raw) {
  const fail = (type, msg) => {
    throw new RequestValidationError([{ loc: ["body", "url"], msg, type }]);
  };
  if ([...raw].length > 2083) fail("url_too_long", "URL should have at most 2083 characters");
  let u;
  try {
    u = new URL(raw);
  } catch {
    // The url crate's words for the common case: no scheme at all.
    const why = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) ? "empty host" : "relative URL without a base";
    fail("url_parsing", `Input should be a valid URL, ${why}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") fail("url_scheme", "URL scheme should be 'http' or 'https'");
  if (!u.hostname) fail("url_parsing", "Input should be a valid URL, empty host");
  return u.href;
}

/** `WebhookSubscription.from_orm(row)`. */
export function fromOrm(row) {
  return construct(WebhookSubscription, {
    id: row.id,
    url: row.url,
    events: jsonLoads(row.events_json),
    secret_set: Boolean(row.secret_hash),
    enabled: row.enabled,
    created_at: row.created_at,
    last_delivery_at: row.last_delivery_at,
    last_status_code: row.last_status_code,
  });
}

const byId = (h, id) => h.one(`select * from ${Webhook} where id = ? limit 1`, [id], Webhook);
const sign = (secret, body) => createHmac("sha256", Buffer.from(secret, "utf8")).update(body).digest("hex");

export async function router(app) {
  app.get("/v1/webhooks", async () => {
    const rows = session.getDb().all(`select * from ${Webhook} order by created_at`, undefined, Webhook);
    return { subscriptions: rows.map(fromOrm) };
  });

  app.post("/v1/webhooks", { schema: { body: CreateWebhookRequest } }, async (req, reply) => {
    const body = req.body;
    const url = httpUrl(body.url);
    const rawSecret = body.secret || tokenUrlsafe(32);
    const h = session.getDb();
    const id = uuid();
    h.insert(Webhook, {
      id,
      url,
      events_json: pyJson(body.events),
      secret_hash: _hashSecret(rawSecret),
      enabled: body.enabled,
    });
    _SECRETS_CACHE.set(id, rawSecret);
    reply.code(201);
    return construct(WebhookWithSecret, { subscription: fromOrm(byId(h, id)), secret: rawSecret });
  });

  app.delete("/v1/webhooks/:webhook_id", async (req) => {
    const h = session.getDb();
    const webhookId = req.params.webhook_id;
    if (byId(h, webhookId) === null) throw notFound(`webhook ${webhookId}`);
    h.delete(Webhook, { id: webhookId });
    _SECRETS_CACHE.delete(webhookId);
    return { deleted: true };
  });

  app.post("/v1/webhooks/:webhook_id/test", async (req) => {
    const h = session.getDb();
    const webhookId = req.params.webhook_id;
    const wh = byId(h, webhookId);
    if (wh === null) throw notFound(`webhook ${webhookId}`);
    const bodyBytes = Buffer.from(pyJson({ event: "webhook.test", ping: Math.trunc(Date.now() / 1000) }), "utf8");
    const headers = {
      "Content-Type": "application/json",
      "X-JustVoice-Signature": sign(_SECRETS_CACHE.get(webhookId) ?? "", bodyBytes),
    };
    const start = performance.now();
    try {
      const resp = await http.fetch(wh.url, { method: "POST", body: bodyBytes, headers, timeoutMs: 10_000 });
      await resp.arrayBuffer();
      const latencyMs = Math.trunc(performance.now() - start);
      h.update(Webhook, { last_status_code: resp.status, last_delivery_at: utcNowNaive() }, { id: webhookId });
      const ok = resp.status >= 200 && resp.status < 300;
      return construct(WebhookTestResult, {
        delivered: ok,
        status_code: resp.status,
        latency_ms: latencyMs,
        error: ok ? null : `HTTP ${resp.status}`,
      });
    } catch (e) {
      return construct(WebhookTestResult, {
        delivered: false,
        status_code: null,
        latency_ms: Math.trunc(performance.now() - start),
        error: String(e?.message ?? e),
      });
    }
  });
}

// ── Background dispatcher (fire-and-forget) ───────────────────────────────

export const _RETRY_DELAYS_S = [1, 5, 30, 300]; // 1s, 5s, 30s, 5m
export const _LOG_TAIL_CAP = 50; // rolling delivery-attempt log, per the module + model docs

/** A non-2xx response is a delivery failure worth retrying. */
export const _isFailureStatus = (statusCode) => !(statusCode >= 200 && statusCode < 300);

const _summarizeExc = (e) => [...`${e?.name ?? "Error"}: ${e?.message ?? e}`].slice(0, 200).join("");

/** The detached dispatcher's database: the test's, else the app's (null before boot). */
export function _openBgDb() {
  return cfg.SessionLocal ?? session.cfg.handle ?? null;
}

/**
 * Persist one delivery attempt: bump last_status_code + last_delivery_at and append a capped
 * `{timestamp, status, error?}` entry to log_tail_json. Every attempt (success AND failure) is
 * recorded. Best-effort: a bookkeeping error must never crash delivery.
 */
export function _recordAttempt(webhookId, statusCode, error) {
  const h = self._openBgDb();
  if (h === null) return;
  try {
    h.tx(() => {
      const wh = byId(h, webhookId);
      if (wh === null) return;
      let tail;
      try {
        tail = jsonLoads(wh.log_tail_json || "[]");
        if (!Array.isArray(tail)) tail = [];
      } catch {
        tail = [];
      }
      const entry = { timestamp: Math.trunc(Date.now() / 1000), status: statusCode };
      if (error) entry.error = error;
      tail.push(entry);
      h.update(
        Webhook,
        { last_status_code: statusCode, last_delivery_at: utcNowNaive(), log_tail_json: pyJson(tail.slice(-_LOG_TAIL_CAP)) },
        { id: webhookId },
      );
    });
  } catch {
    /* bookkeeping must not kill delivery (the transaction rolled back) */
  }
}

/** Fan out an event to all enabled webhooks subscribed to it. The caller fire-and-forgets it.
 * (Nothing calls it today — as in Python.) */
export async function dispatchEvent(event, payload, h) {
  const subs = h.all(`select * from ${Webhook} where enabled = 1`, undefined, Webhook);
  for (const sub of subs) {
    const events = jsonLoads(sub.events_json || "[]");
    if (!(Array.isArray(events) ? events.includes(event) : isDict(events) && Object.hasOwn(events, event))) continue;
    self._deliverWithRetry(sub.id, sub.url, event, payload).catch(() => {});
  }
}

export async function _deliverWithRetry(webhookId, url, event, payload) {
  const bodyBytes = Buffer.from(pyJson({ event, data: payload, timestamp: Math.trunc(Date.now() / 1000) }), "utf8");
  const headers = {
    "Content-Type": "application/json",
    "X-JustVoice-Signature": sign(_SECRETS_CACHE.get(webhookId) ?? "", bodyBytes),
    "X-JustVoice-Event": event,
  };

  // One delivery attempt. Records the outcome — status code, or the exception summary for a
  // transport failure — BEFORE returning/throwing, so last_status_code + log_tail reflect every
  // attempt.
  const attempt = async () => {
    let resp;
    try {
      resp = await http.fetch(url, { method: "POST", body: bodyBytes, headers, timeoutMs: 15_000 });
      await resp.arrayBuffer?.();
    } catch (e) {
      self._recordAttempt(webhookId, null, _summarizeExc(e));
      throw e;
    }
    self._recordAttempt(webhookId, resp.status, _isFailureStatus(resp.status) ? `HTTP ${resp.status}` : null);
    return resp.status;
  };

  // 5 attempts total: the first, then the [1,5,30,300]s ladder. Retry on any transport
  // exception OR a non-2xx status; on exhaustion give up quietly — delivery is fire-and-forget
  // and every attempt is already recorded.
  const attempts = 1 + _RETRY_DELAYS_S.length;
  for (let i = 0; i < attempts; i++) {
    let ok = false;
    try {
      ok = !_isFailureStatus(await attempt());
    } catch {
      ok = false;
    }
    if (ok) return;
    if (i < attempts - 1) await sleep(cfg.waitLadder(i) * 1000);
  }
}
