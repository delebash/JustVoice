// SPDX-License-Identifier: MIT
// Who is calling the MCP server — the calling client's id and address, available to a tool for
// the length of one `/mcp` request (Node's AsyncLocalStorage), and the "last seen" stamp in
// `mcp_bindings` that Settings → MCP shows.
//
// A client names itself with the `X-JustVoice-Client-Id` header (users' MCP configs and the
// Settings snippets send it). Outside a request — the in-memory transport the tests use, a
// background task — there is no client id and no address.

import { AsyncLocalStorage } from "node:async_hooks";
import { clientHost, isDirectLoopback } from "@delebash/core/platform/auth";
import { getLogger } from "@delebash/core/platform/log";
import { MCPBinding } from "../database/models.js";
import { getDb } from "../database/session.js";
import { utcNowNaive } from "../models.js";

const log = getLogger("justvoice.mcp.context");

/** The header a client names itself with (HTTP headers are case-insensitive). */
export const CLIENT_ID_HEADER = "X-JustVoice-Client-Id";
const HEADER_KEY = CLIENT_ID_HEADER.toLowerCase();

const current = new AsyncLocalStorage();

/** The context of one HTTP request (a Hono context): its client id (from the header), the
 * socket's address (none where the request has no socket), and whether it came straight from this
 * computer — a loopback socket and no proxy's forwarding header (the kit's `isDirectLoopback`: a
 * reverse proxy on this computer makes every client look like loopback; decided 2026-10-20). */
export function requestContext(c) {
  return {
    clientId: c.req.header(HEADER_KEY) || null,
    remoteAddr: clientHost(c) || null,
    local: isDirectLoopback(c),
  };
}

/** Run `fn` with this request's `{clientId, remoteAddr, local}` in reach of `currentClientId()`,
 * `currentRemoteAddr()` and `requestIsLoopback()`. */
export function runWithRequest(context, fn) {
  return current.run({ clientId: context?.clientId ?? null, remoteAddr: context?.remoteAddr ?? null, local: context?.local === true }, fn);
}

export const currentClientId = () => current.getStore()?.clientId ?? null;
export const currentRemoteAddr = () => current.getStore()?.remoteAddr ?? null;

/** Did the calling request come straight from this computer (`requestContext`'s `local`)? No
 * request is not. */
export const requestIsLoopback = () => current.getStore()?.local === true;

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

/** Stamp the calling client after every MCP response — a middleware on the root app, added
 * before every other (app.js), so it stamps whatever answered: the route, a guard's refusal, an
 * error. Its stamp runs once the answer is made. */
export async function clientIdStamp(c, next) {
  await next();
  if (!_isStampedPath(c.req.path)) return;
  const clientId = c.req.header(HEADER_KEY);
  if (clientId) _stampLastSeen(clientId);
}
