// SPDX-License-Identifier: MIT
// Who is calling the MCP server — the calling client's id and address, available to a tool for
// the length of one `/mcp` request (Node's AsyncLocalStorage), and the "last seen" stamp in
// `mcp_bindings` that Settings → MCP shows.
//
// A client names itself with the `X-JustVoice-Client-Id` header (users' MCP configs and the
// Settings snippets send it). Outside a request — the in-memory transport the tests use, a
// background task — there is no client id and no address.

import { AsyncLocalStorage } from "node:async_hooks";
import { isLoopback } from "@delebash/llm-runner/platform/auth";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { MCPBinding } from "../database/models.js";
import { getDb } from "../database/session.js";
import { utcNowNaive } from "../models.js";

const log = getLogger("justvoice.mcp.context");

/** The header a client names itself with (HTTP headers are case-insensitive). */
export const CLIENT_ID_HEADER = "X-JustVoice-Client-Id";
const HEADER_KEY = CLIENT_ID_HEADER.toLowerCase();

const current = new AsyncLocalStorage();

/** A header's first value, or null. */
export function headerValue(headers, name = HEADER_KEY) {
  const v = headers?.[name];
  const first = Array.isArray(v) ? v[0] : v;
  return first ? String(first) : null;
}

/** The context of one HTTP request: its client id (from the header) and the socket's address. */
export function requestContext(request) {
  return {
    clientId: headerValue(request.headers),
    remoteAddr: request.socket?.remoteAddress ?? request.raw?.socket?.remoteAddress ?? null,
  };
}

/** Run `fn` with this request's `{clientId, remoteAddr}` in reach of `currentClientId()` and
 * `currentRemoteAddr()`. */
export function runWithRequest(context, fn) {
  return current.run({ clientId: context?.clientId ?? null, remoteAddr: context?.remoteAddr ?? null }, fn);
}

export const currentClientId = () => current.getStore()?.clientId ?? null;
export const currentRemoteAddr = () => current.getStore()?.remoteAddr ?? null;

/** Is the calling socket on this machine? 127.0.0.0/8, `::1`, or an IPv4-mapped 127.x address
 * (`::ffff:127.0.0.1`, what a dual-stack socket reports) — the kit's one loopback test, the same
 * the bearer auth uses. No request, or an address that does not parse, is not. */
export const isLoopbackAddress = (addr) => Boolean(addr) && isLoopback(String(addr));

export const requestIsLoopback = () => isLoopbackAddress(currentRemoteAddr());

/** Does this path belong to the MCP endpoint? `/mcp` or under `/mcp/` (the query is ignored). */
export function _isStampedPath(url) {
  const p = String(url ?? "").split("?")[0];
  return p === "/mcp" || p.startsWith("/mcp/");
}

/** Record that `clientId` was just heard from: create its binding row, or move its
 * `last_seen_at` to now. Never throws — no database yet is skipped quietly, anything else is
 * logged at debug. */
export function _stampLastSeen(clientId) {
  let h;
  try {
    h = getDb();
  } catch {
    return;
  }
  try {
    const now = utcNowNaive();
    h.tx(() => {
      if (h.get(MCPBinding, clientId) === null) h.insert(MCPBinding, { client_id: clientId, last_seen_at: now });
      else h.update(MCPBinding, { last_seen_at: now }, { client_id: clientId });
    });
  } catch (e) {
    log.debug(`could not stamp last_seen_at for MCP client ${clientId}: ${e?.message ?? e}`);
  }
}

/** Stamp the calling client after every MCP response (an `onResponse` hook on the root app). */
export function installClientIdHook(app) {
  app.addHook("onResponse", async (request) => {
    if (!_isStampedPath(request.raw?.url ?? request.url)) return;
    const clientId = headerValue(request.headers);
    if (clientId) _stampLastSeen(clientId);
  });
}
