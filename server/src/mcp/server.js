// SPDX-License-Identifier: MIT
// The MCP endpoint — JustVoice's tools (tools.js) over the Model Context Protocol's Streamable
// HTTP transport at `/mcp` on the app's own port, so an agent (Claude Code, Claude Desktop,
// Cursor, any MCP client) can list voices and personas, speak and transcribe through the running
// server.
//
// Built on the official SDK the way its stateful Streamable HTTP example does it: one
// `McpServer` and one transport per session, kept by the session id the transport hands out on
// `initialize`; every later request names its session in the `mcp-session-id` header and its
// transport does the protocol work (POST messages, GET the server's event stream, DELETE ends the
// session). The transport is the SDK's web-standard one (`WebStandardStreamableHTTPServerTransport`
// — the SDK's Node transport is this one wrapped for Node's request/response): it takes the
// request (a web Request) and answers with a Response, as every Hono route does.
//
//   - no session id, an `initialize` POST → a new session (its id: 32 lowercase hex digits);
//   - a session id that names no open session → 404, the spec's "initialize again";
//   - no session id and anything else → 400.
//
// `/mcp` sits behind the same bearer-token and Origin guards as `/v1` (app.js). Each request runs
// inside its own context (context.js), so a tool can read the calling client's id and address;
// the response stamps the client's "last seen" (context.js `clientIdStamp`, app.js's first
// middleware).

import { randomUUID } from "node:crypto";
import { readJson } from "@delebash/llm-runner/platform";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../version.js";
import { requestContext, runWithRequest } from "./context.js";
import { registerTools } from "./tools.js";

const log = getLogger("justvoice.mcp.server");

export const SERVER_NAME = "justvoice";
export const SERVER_VERSION = VERSION;
export const INSTRUCTIONS =
  "JustVoice is a voice production server running on this machine. justvoice.speak renders text in one of its " +
  "voices and returns an audio_url to fetch the WAV from; justvoice.list_voices and justvoice.list_personas " +
  "find the voices and personas to ask for.";

/** A JustVoice MCP server with the four tools, not yet connected to a transport. */
export function buildMcpServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  registerTools(server);
  return server;
}

/** A JSON-RPC error answer that no transport sent (the request never reached a session). */
function refuse(c, status, message) {
  return c.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, status);
}

/**
 * Mount `/mcp` (and `/mcp/`) on the Hono app — GET, POST and DELETE. Synchronous: the routes
 * exist when this returns. Touches neither the database nor the app state until a request
 * arrives. `close()` ends every open session. The last-seen stamp is app.js's
 * (`clientIdStamp`, a middleware that must come before these routes).
 */
export function mountInto(app) {
  const sessions = new Map(); // session id → its transport

  async function openSession() {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID().replaceAll("-", ""),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
        log.info(`MCP session ${id} opened`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await buildMcpServer().connect(transport);
    return transport;
  }

  async function handle(c) {
    const sessionId = c.req.header("mcp-session-id") || null;
    // The body read by the family's rules (as every route's) and handed to the transport parsed.
    const body = c.req.method === "POST" ? await readJson(c) : undefined;
    let transport;
    if (sessionId) {
      transport = sessions.get(sessionId);
      if (!transport) return refuse(c, 404, "Session not found — send a new initialize request.");
    } else if (c.req.method === "POST" && isInitializeRequest(body)) {
      transport = await openSession();
    } else {
      return refuse(c, 400, "Bad Request: no valid session id — a session starts with an initialize request.");
    }
    // From here the transport makes the answer itself (its own status, headers and body — an
    // event stream or JSON); headers a middleware already set on `c` ride along.
    let res;
    try {
      res = await runWithRequest(requestContext(c), () => transport.handleRequest(c.req.raw, { parsedBody: body }));
    } catch (e) {
      log.warning(`MCP request failed: ${e?.message ?? e}`);
      return c.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }, 500);
    }
    return c.body(res.body, res);
  }

  app.on(["GET", "POST", "DELETE"], ["/mcp", "/mcp/"], handle);
  log.info("MCP server mounted at /mcp (Streamable HTTP)");

  return {
    async close() {
      const open = [...sessions.values()];
      sessions.clear();
      for (const transport of open) {
        try {
          await transport.close();
        } catch (e) {
          log.debug(`closing an MCP session raised: ${e?.message ?? e}`);
        }
      }
    },
  };
}
