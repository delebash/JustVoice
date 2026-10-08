// SPDX-License-Identifier: MIT
// The MCP endpoint — JustVoice's tools (tools.js) over the Model Context Protocol's Streamable
// HTTP transport at `/mcp` on the app's own port, so an agent (Claude Code, Claude Desktop,
// Cursor, any MCP client) can list voices and personas, speak and transcribe through the running
// server.
//
// Built on the official SDK the way its stateful Streamable HTTP example does it: one
// `McpServer` and one `StreamableHTTPServerTransport` per session, kept by the session id the
// transport hands out on `initialize`; every later request names its session in the
// `mcp-session-id` header and its transport does the protocol work (POST messages, GET the
// server's event stream, DELETE ends the session).
//
//   - no session id, an `initialize` POST → a new session (its id: 32 lowercase hex digits);
//   - a session id that names no open session → 404, the spec's "initialize again";
//   - no session id and anything else → 400.
//
// `/mcp` sits behind the same bearer-token and Origin guards as `/v1` (app.js). Each request runs
// inside its own context (context.js), so a tool can read the calling client's id and address;
// the response stamps the client's "last seen".

import { randomUUID } from "node:crypto";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../version.js";
import { headerValue, installClientIdHook, requestContext, runWithRequest } from "./context.js";
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
function refuse(reply, status, message) {
  return reply.code(status).type("application/json").send({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

/**
 * Mount `/mcp` (and `/mcp/`) on the Fastify app — GET, POST and DELETE — and the last-seen
 * stamp. Synchronous: the routes exist when this returns. Touches neither the database nor the
 * app state until a request arrives. `close()` ends every open session.
 */
export function mountInto(app) {
  const sessions = new Map(); // session id → its transport

  async function openSession() {
    const transport = new StreamableHTTPServerTransport({
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

  async function handle(request, reply) {
    const sessionId = headerValue(request.headers, "mcp-session-id");
    let transport;
    if (sessionId) {
      transport = sessions.get(sessionId);
      if (!transport) return refuse(reply, 404, "Session not found — send a new initialize request.");
    } else if (request.method === "POST" && isInitializeRequest(request.body)) {
      transport = await openSession();
    } else {
      return refuse(reply, 400, "Bad Request: no valid session id — a session starts with an initialize request.");
    }
    // From here the transport writes the answer itself.
    reply.hijack();
    try {
      await runWithRequest(requestContext(request), () =>
        transport.handleRequest(request.raw, reply.raw, request.method === "POST" ? request.body : undefined),
      );
    } catch (e) {
      log.warning(`MCP request failed: ${e?.message ?? e}`);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
      }
    }
  }

  for (const url of ["/mcp", "/mcp/"]) app.route({ method: ["GET", "POST", "DELETE"], url, handler: handle });
  installClientIdHook(app);
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
