// SPDX-License-Identifier: MIT
// MCP server tests — the /mcp mount, tool registration, and voice resolution precedence (the
// port of tests/test_mcp_server.py). Speak's render path needs a loaded engine, so it's covered
// by the end-to-end suite; here we verify the wiring. Python's fixture booted the whole app
// (create_app); these boot what the tools read — the database and the app state — and mount
// on a bare server (app.js is the API wave's).
import { createServer } from "@delebash/llm-runner/platform/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test } from "vitest";
import { AppState, cfg as appCfg, setState } from "../src/app_state.js";
import { MCPBinding } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { mountInto } from "../src/mcp/index.js";
import { resolveVoice } from "../src/mcp/resolve.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { closeModuleDb, initDbAt, tmpPath } from "./helpers.js";

function boot() {
  const dir = tmpPath();
  initDbAt(dir);
  const st = new AppState(dir);
  setState(st);
  return st;
}

afterEach(() => {
  closeModuleDb();
  appCfg.state = null;
});

async function connected() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildMcpServer().connect(serverSide);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  return client;
}

test("mcp_mounted", async () => {
  const app = createServer({ typeBase: "https://justvoice.dev/errors/" });
  mountInto(app);
  await app.ready();
  expect(app.hasRoute({ method: "POST", url: "/mcp" })).toBe(true);
  expect(app.hasRoute({ method: "GET", url: "/mcp" })).toBe(true);
  await app.close();
});

test("tools_registered", async () => {
  const client = await connected();
  const names = new Set((await client.listTools()).tools.map((t) => t.name));
  for (const n of ["justvoice.speak", "justvoice.transcribe", "justvoice.list_voices", "justvoice.list_personas"]) expect(names).toContain(n);
  await client.close();
});

test("resolve_precedence", () => {
  // explicit voice > explicit persona > client binding > settings default.
  const st = boot();
  const persona = st.personas.create("Mara Vance", { voice_id: "af_heart" });
  const h = session.getDb();

  // 1. Explicit voice wins outright.
  let r = resolveVoice("voice-x", "Mara Vance", "cli-1", h);
  expect(r?.voice_id).toBe("voice-x");
  expect(r.persona).toBeNull();

  // 2. Persona by NAME (case-insensitive) resolves to its voice.
  r = resolveVoice(null, "mara vance", null, h);
  expect(r?.voice_id).toBe("af_heart");
  expect(r.persona.id).toBe(persona.id);

  // 3. Client binding's persona applies when no explicit args.
  h.insert(MCPBinding, { client_id: "cli-1", persona_id: persona.id });
  r = resolveVoice(null, null, "cli-1", h);
  expect(r?.voice_id).toBe("af_heart");

  // 4. Unknown client with no default → null.
  expect(resolveVoice(null, null, "cli-unknown", h)).toBeNull();

  // 5. settings.mcp.default_voice is the final fallback.
  const settings = st.settings.get();
  settings.mcp.default_voice = "fallback-voice";
  st.settings.set(settings);
  r = resolveVoice(null, null, "cli-unknown", h);
  expect(r?.voice_id).toBe("fallback-voice");
});

test("speak_without_resolvable_voice_raises", async () => {
  // The helpful-error contract: no args, no binding, no default.
  boot();
  const client = await connected();
  const result = await client.callTool({ name: "justvoice.speak", arguments: { text: "hello" } });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("No voice resolved");
  await client.close();
});
