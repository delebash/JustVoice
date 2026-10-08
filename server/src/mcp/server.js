// SPDX-License-Identifier: MIT
//
// Adapted from voicebox (MIT) — backend/mcp_server/server.py at the commit pinned in
// voicebox-pin.txt. Original copyright (c) the voicebox authors.
//
// Construct the MCP server and mount it on the Fastify app (the port of
// justvoice/mcp/server.py, which built a FastMCP server and mounted its Streamable HTTP app).
//
// The MCP endpoint lives at `/mcp` (Streamable HTTP transport). Modern MCP clients (Claude Code,
// Cursor, Windsurf, VS Code MCP extensions) connect directly via URL:
//
//     claude mcp add justvoice --transport http \
//         --url http://127.0.0.1:17494/mcp \
//         --header "X-JustVoice-Client-Id: claude-code"
//
// Built on the official TypeScript SDK's low-level `Server` (@modelcontextprotocol/sdk) so the
// wire is under our hand: the capabilities, server info, protocol versions, tool list and
// results are fastmcp 3.4.5's (on mcp 1.29.0), as the Python server sends them. Sessions are
// stateful, as fastmcp's: one SDK server + transport per `mcp-session-id` (32 hex digits).

import { randomUUID } from "node:crypto";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CLIENT_ID_HEADER, installClientIdHook, runWithRequest } from "./context.js";
import { callTool, listTools } from "./tools.js";

const log = getLogger("justvoice.mcp.server");

export const SERVER_NAME = "justvoice";
// fastmcp's own version is what the Python server reports as its serverInfo.version.
export const SERVER_VERSION = "3.4.5";
export const INSTRUCTIONS =
  "JustVoice is a local voice production server. Use `justvoice.speak` to render text in a voice (returns an audio URL), and the `list_*` tools to discover voices and personas.";

// What fastmcp advertises (it serves empty prompt and resource lists).
export const CAPABILITIES = {
  experimental: {},
  logging: {},
  prompts: { listChanged: true },
  resources: { subscribe: false, listChanged: true },
  tools: { listChanged: true },
  extensions: { "io.modelcontextprotocol/ui": {} },
};

// mcp 1.29.0's SUPPORTED_PROTOCOL_VERSIONS and LATEST (the SDK also takes 2024-10-07).
const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const LATEST_PROTOCOL_VERSION = "2025-11-25";

class JustVoiceMcpServer extends Server {
  async _oninitialize(request) {
    const requested = request.params.protocolVersion;
    this._clientCapabilities = request.params.capabilities;
    this._clientVersion = request.params.clientInfo;
    return {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
      capabilities: this.getCapabilities(),
      serverInfo: this._serverInfo,
      instructions: this._instructions,
    };
  }
}

/** One MCP server with JustVoice's tools registered (one per session). */
export function buildMcpServer() {
  const server = new JustVoiceMcpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: CAPABILITIES, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(request.params.name, request.params.arguments));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
  // A method the server doesn't serve answers as the Python server's does.
  server.fallbackRequestHandler = async () => {
    const e = new Error("Invalid request parameters");
    e.code = -32602;
    e.data = "";
    throw e;
  };
  return server;
}

/** The transport-level refusal the Python transport writes (`id: "server-error"`). */
function refuse(reply, status, message) {
  reply
    .code(status)
    .header("content-type", "application/json")
    .send(JSON.stringify({ jsonrpc: "2.0", id: "server-error", error: { code: -32600, message } }));
}

const accepts = (req) => (req.headers.accept || "").split(",").map((t) => t.trim());
const isInitialize = (body) => body !== null && typeof body === "object" && !Array.isArray(body) && body.method === "initialize";

/**
 * Attach the MCP endpoint to `app` at `/mcp` (and `/mcp/`), with the client-id hook. The app
 * boot calls this once, before any catch-all route. Returns `{close}` — the shutdown closes
 * every open session.
 */
export function mountInto(app) {
  const sessions = new Map(); // mcp-session-id → {server, transport}

  installClientIdHook(app);

  const handler = async (request, reply) => {
    const clientId = request.headers[CLIENT_ID_HEADER.toLowerCase()] ?? null;
    const ctx = { clientId: Array.isArray(clientId) ? clientId[0] : clientId, remoteAddr: request.socket?.remoteAddress ?? null };
    const sid = request.headers["mcp-session-id"];

    let entry;
    if (sid !== undefined) {
      entry = sessions.get(sid);
      // Unknown or expired session ID — 404 per the MCP spec.
      if (!entry) return refuse(reply, 404, "Session not found");
    } else {
      // A new session: the Python transport's checks for a request with no session id.
      const acc = accepts(request.raw);
      if (request.method === "GET" && !acc.some((t) => t.startsWith("text/event-stream"))) {
        return refuse(reply, 406, "Not Acceptable: Client must accept text/event-stream");
      }
      if (request.method === "POST") {
        if (!(acc.some((t) => t.startsWith("application/json")) && acc.some((t) => t.startsWith("text/event-stream")))) {
          return refuse(reply, 406, "Not Acceptable: Client must accept both application/json and text/event-stream");
        }
        const ct = (request.headers["content-type"] || "").split(";")[0].split(",").map((p) => p.trim());
        if (!ct.includes("application/json")) return refuse(reply, 415, "Unsupported Media Type: Content-Type must be application/json");
      }
      if (request.method !== "POST" || !isInitialize(request.body)) return refuse(reply, 400, "Bad Request: Missing session ID");
      const newId = randomUUID().replaceAll("-", "");
      const server = buildMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newId,
        onsessioninitialized: (id) => {
          sessions.set(id, entry);
          log.info(`Created new transport with session ID: ${id}`);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      entry = { server, transport };
      await server.connect(transport);
    }

    reply.hijack();
    await runWithRequest(ctx, () => entry.transport.handleRequest(request.raw, reply.raw, request.body));
  };

  for (const url of ["/mcp", "/mcp/"]) app.route({ method: ["GET", "POST", "DELETE"], url, handler });
  log.info("MCP: mounted at /mcp");

  return {
    async close() {
      for (const { transport } of [...sessions.values()]) await transport.close();
      sessions.clear();
    },
  };
}
