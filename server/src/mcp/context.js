// SPDX-License-Identifier: MIT
//
// Adapted from voicebox (MIT) — backend/mcp_server/context.py at the commit pinned in
// voicebox-pin.txt. Header renamed, binding model + paths adjusted to JustVoice's schema.
// Original copyright (c) the voicebox authors.
//
// Per-request client identity for MCP calls (the port of justvoice/mcp/context.py).
//
// MCP clients identify themselves via an `X-JustVoice-Client-Id` HTTP header (direct-HTTP
// clients set it in their MCP config). The /mcp route runs the transport inside an
// AsyncLocalStorage store holding that value and the caller's address (Python's ContextVars,
// set by a Starlette middleware), so tool implementations can read them without plumbing the
// request through every call; a Fastify onResponse hook stamps the binding's last_seen_at.

import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { MCPBinding } from "../database/models.js";
import * as session from "../database/session.js";
import { utcNowNaive } from "../models.js";

const log = getLogger("justvoice.mcp.context");

export const CLIENT_ID_HEADER = "X-JustVoice-Client-Id";

const store = new AsyncLocalStorage();

/** Run `fn` with this request's client id and remote address in scope. */
export function runWithRequest({ clientId, remoteAddr }, fn) {
  return store.run({ clientId: clientId ?? null, remoteAddr: remoteAddr ?? null }, fn);
}

/** The X-JustVoice-Client-Id of the in-flight MCP request, or null. Tool handlers read this to
 * apply per-client voice bindings. */
export const currentClientId = () => store.getStore()?.clientId ?? null;

/** The remote address of the in-flight request — tools that gate host-filesystem access to
 * loopback callers read it. */
export const currentRemoteAddr = () => store.getStore()?.remoteAddr ?? null;

/** An IPv6 address's eight 16-bit groups. */
function ipv6Groups(addr) {
  let a = addr.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [b0, b1, b2, b3] = v4.slice(1).map(Number);
    a = `${a.slice(0, v4.index)}${((b0 << 8) | b1).toString(16)}:${((b2 << 8) | b3).toString(16)}`;
  }
  const [head, tail] = a.includes("::") ? a.split("::") : [a, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return groups.map((g) => Number.parseInt(g, 16));
}

/** `ipaddress.ip_address(addr).is_loopback` — 127.0.0.0/8, ::1, and (Python 3.12.9) an
 * IPv4-mapped 127.x. */
function isLoopbackAddress(addr) {
  const kind = isIP(addr);
  if (kind === 4) return addr.split(".")[0] === "127";
  if (kind === 6) {
    const g = ipv6Groups(addr);
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
    return g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff && g[6] >> 8 === 127;
  }
  return false;
}

/**
 * True when the in-flight request originated on the loopback interface. False if no request is
 * in flight or the remote address can't be parsed — callers gating filesystem reads on this
 * treat that as "deny".
 */
export function requestIsLoopback() {
  const addr = currentRemoteAddr();
  if (!addr) return false;
  return isLoopbackAddress(addr);
}

// Paths whose calls act on the caller's MCP bindings — only these stamp last_seen_at, so the
// bindings UI's "last heard from" column reflects real MCP/speak traffic, not unrelated REST
// calls that set the header.
const _STAMPED_PATH_PREFIXES = ["/mcp"];

/** A path boundary is required, so a future `/mcpfoo` route doesn't inherit the stamp. */
export function _isStampedPath(path) {
  return _STAMPED_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Update or create the MCPBinding row for this client_id. Never raises. */
export function _stampLastSeen(clientId) {
  let h;
  try {
    h = session.getDb();
  } catch {
    return;
  }
  try {
    h.tx(() => {
      const row = h.get(MCPBinding, clientId);
      const now = utcNowNaive();
      if (row === null) h.insert(MCPBinding, { client_id: clientId, last_seen_at: now });
      else h.update(MCPBinding, { last_seen_at: now }, { client_id: clientId });
    });
  } catch (e) {
    log.debug(`could not stamp last_seen_at for ${clientId}: ${e?.message ?? e}`);
  }
}

/**
 * The middleware's other half, as a Fastify hook: after a request to `/mcp` (or below it) that
 * carried the client-id header, stamp that binding's last_seen_at. Python stamped from a thread
 * after the response; here the write is synchronous and runs once the response is sent.
 */
export function installClientIdHook(app) {
  app.addHook("onResponse", async (request) => {
    const clientId = request.headers[CLIENT_ID_HEADER.toLowerCase()];
    const path = request.url.split("?")[0];
    if (clientId && _isStampedPath(path)) _stampLastSeen(Array.isArray(clientId) ? clientId[0] : clientId);
  });
}
