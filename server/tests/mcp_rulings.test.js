// SPDX-License-Identifier: MIT
// The MCP endpoint's fixes of 2026-10-08 (the clean-room rewrite's rulings):
//   11 — /mcp sits behind the same bearer token and Origin guard as /v1;
//   12 — speak's duration_sec comes from the WAV's own header (any sample rate);
//   13 — speak stores the language it spoke (the persona's, when that was used);
//   14 — Settings → MCP's curl snippet works against the session-based server;
//   18 — transcribe treats an empty audio_path as not given.
// Plus the session model itself: an unknown session is a 404, a request with no session that is
// not an initialize is a 400.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test, vi } from "vitest";
import * as captures from "../src/api/captures_api.js";
import * as generateApi from "../src/api/generate_api.js";
import { AppState, cfg as appCfg, getState, setState } from "../src/app_state.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { Generation } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { SOURCE_ROOT } from "../src/paths.js";
import { appClient, closeApps } from "./app_helpers.js";
import { closeModuleDb, initDbAt, inject, tmpPath } from "./helpers.js";

afterEach(async () => {
  await closeApps();
  closeModuleDb();
  appCfg.state = null;
});

const ACCEPT = "application/json, text/event-stream";
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
};
const mcpPost = (c, body, headers = {}) =>
  c.post("/mcp", { json: body, headers: { accept: ACCEPT, "content-type": "application/json", ...headers } });

/** The JSON-RPC messages in an SSE answer (or the JSON answer itself). */
function messages(text) {
  if (text.trimStart().startsWith("{")) return [JSON.parse(text)];
  return text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
}

function boot() {
  const dir = tmpPath();
  initDbAt(dir);
  const st = new AppState(dir);
  setState(st);
  return st;
}

async function connected() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildMcpServer().connect(serverSide);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
  return client;
}

const toneWav = (seconds, rate) => writeWavContainer(Buffer.alloc(Math.round(seconds * rate) * 2), rate, 1);

test("an_initialize_opens_a_session_and_unknown_or_missing_sessions_are_refused", async () => {
  const { c } = await appClient();
  const r = await mcpPost(c, initialize);
  expect(r.status, r.text).toBe(200);
  expect(r.headers["mcp-session-id"]).toMatch(/^[0-9a-f]{32}$/);
  expect(messages(r.text)[0].result.serverInfo.name).toBe("justvoice");

  const unknown = await mcpPost(c, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "0".repeat(32) });
  expect(unknown.status).toBe(404);
  const none = await mcpPost(c, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  expect(none.status).toBe(400);

  const listed = await mcpPost(c, { jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-session-id": r.headers["mcp-session-id"] });
  expect(listed.status, listed.text).toBe(200);
  expect(messages(listed.text)[0].result.tools.map((t) => t.name)).toContain("justvoice.speak");
});

test("mcp_needs_the_token_like_the_api", async () => {
  // Ruling 11: tokens set, a caller from another machine.
  const { app } = await appClient(undefined, { remoteAddress: "192.168.1.20" });
  const settings = getState().settings.get();
  settings.auth.tokens = ["s3cret"];
  getState().settings.set(settings);
  const send = (headers) =>
    inject(app, {
      method: "POST",
      url: "/mcp",
      remoteAddress: "192.168.1.20",
      payload: JSON.stringify(initialize),
      headers: { accept: ACCEPT, "content-type": "application/json", ...headers },
    });
  expect((await send({})).statusCode).toBe(401);
  expect((await send({ authorization: "Bearer wrong" })).statusCode).toBe(403);
  expect((await send({ authorization: "Bearer s3cret" })).statusCode).toBe(200);
});

test("mcp_refuses_a_foreign_page_but_not_a_client_without_an_origin", async () => {
  // Ruling 11: the Origin guard. An MCP client is not a browser and sends no Origin.
  const { c } = await appClient();
  const foreign = await mcpPost(c, initialize, { origin: "http://evil.example" });
  expect(foreign.status).toBe(403);
  expect(foreign.json().type.endsWith("/cross-origin")).toBe(true);
  expect((await mcpPost(c, initialize)).status).toBe(200);
});

test("the_settings_curl_snippet_opens_a_session", async () => {
  // Ruling 14: replay Settings → MCP's curl line exactly as the user copies it.
  const vue = readFileSync(path.join(SOURCE_ROOT, "src", "pages", "SettingsPage.vue"), "utf8");
  const line = /^\s*curl: `(curl [^`]+)`,$/m.exec(vue)?.[1];
  expect(line, "the curl snippet").toBeTruthy();
  expect(line).toContain("${api.serverUrl}/mcp");
  const headers = {};
  for (const [, h] of line.matchAll(/-H '([^']+)'/g)) {
    const i = h.indexOf(":");
    headers[h.slice(0, i).trim().toLowerCase()] = h.slice(i + 1).trim();
  }
  const body = /-d '([^']+)'/.exec(line)[1];
  const { app } = await appClient();
  const r = await inject(app, { method: "POST", url: "/mcp", headers, payload: body, remoteAddress: "127.0.0.1" });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.headers["mcp-session-id"]).toMatch(/^[0-9a-f]{32}$/);
  expect(messages(r.body)[0].result.serverInfo.name).toBe("justvoice");
});

test("speak_reads_its_length_from_the_wav_header", async () => {
  // Ruling 12: a 24 kHz line of 1.5 s is 1.5 s — not the 16 kHz guess (2.25 s).
  const st = boot();
  const settings = st.settings.get();
  settings.mcp.default_voice = "voice-x";
  st.settings.set(settings);
  vi.spyOn(generateApi, "generate").mockResolvedValue(toneWav(1.5, 24000));
  const client = await connected();
  const r = await client.callTool({ name: "justvoice.speak", arguments: { text: "hello" } });
  expect(r.isError, r.content[0].text).toBeFalsy();
  const out = JSON.parse(r.content[0].text);
  expect(out.duration_sec).toBe(1.5);
  expect(out.audio_url).toBe(`/v1/generations/${out.generation_id}/audio`);
  expect(session.getDb().get(Generation, out.generation_id).duration_sec).toBe(1.5);
  await client.close();
});

test("speak_stores_the_personas_language_when_it_spoke_in_it", async () => {
  // Ruling 13: no language given, the persona speaks Japanese → the row says ja.
  const st = boot();
  st.personas.create("Aiko", { voice_id: "jf_alpha", language: "ja" });
  const gen = vi.spyOn(generateApi, "generate").mockResolvedValue(toneWav(0.5, 24000));
  const client = await connected();
  const r = await client.callTool({ name: "justvoice.speak", arguments: { text: "konnichiwa", persona: "Aiko" } });
  expect(r.isError, r.content[0].text).toBeFalsy();
  const out = JSON.parse(r.content[0].text);
  expect(gen.mock.calls[0][0].language).toBe("ja");
  expect(out.persona).toBe("Aiko");
  expect(session.getDb().get(Generation, out.generation_id).language).toBe("ja");

  // A language the caller names wins, and is what is stored.
  const r2 = await client.callTool({ name: "justvoice.speak", arguments: { text: "hello", persona: "Aiko", language: "en" } });
  expect(session.getDb().get(Generation, JSON.parse(r2.content[0].text).generation_id).language).toBe("en");
  await client.close();
});

test("transcribe_treats_an_empty_audio_path_as_not_given", async () => {
  // Ruling 18.
  boot();
  const stt = vi.spyOn(captures, "_sttTranscribe").mockResolvedValue("hello there");
  const client = await connected();
  const audio = toneWav(0.2, 16000).toString("base64");
  const r = await client.callTool({ name: "justvoice.transcribe", arguments: { audio_path: "", audio_base64: audio } });
  expect(r.isError, r.content[0].text).toBeFalsy();
  expect(JSON.parse(r.content[0].text)).toEqual({ text: "hello there", language: null });
  expect(stt).toHaveBeenCalledOnce();

  const none = await client.callTool({ name: "justvoice.transcribe", arguments: { audio_path: "" } });
  expect(none.isError).toBe(true);
  expect(none.content[0].text).toContain("exactly one of audio_base64 or audio_path");
  await client.close();
});

test("the_client_header_reaches_the_tool_and_stamps_last_seen", async () => {
  // Over real HTTP: the X-JustVoice-Client-Id header picks the client's bound persona, and the
  // binding's last_seen_at is stamped after the answer.
  const { c } = await appClient();
  const st = getState();
  const persona = st.personas.create("Mara Vance", { voice_id: "af_heart" });
  await c.post("/v1/mcp/bindings", { json: { client_id: "cli-9", persona_id: persona.id } });
  const gen = vi.spyOn(generateApi, "generate").mockResolvedValue(toneWav(0.5, 24000));
  const who = { "x-justvoice-client-id": "cli-9" };
  const init = await mcpPost(c, initialize, who);
  const sid = init.headers["mcp-session-id"];
  await mcpPost(c, { jsonrpc: "2.0", method: "notifications/initialized" }, { ...who, "mcp-session-id": sid });
  const r = await mcpPost(
    c,
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "justvoice.speak", arguments: { text: "hi" } } },
    { ...who, "mcp-session-id": sid },
  );
  expect(r.status, r.text).toBe(200);
  const result = messages(r.text)[0].result;
  expect(result.isError, result.content[0].text).toBeFalsy();
  expect(gen.mock.calls[0][0].voice).toBe("af_heart");
  expect(JSON.parse(result.content[0].text).persona).toBe("Mara Vance");
  const bindings = (await c.get("/v1/mcp/bindings")).json().bindings;
  expect(bindings.find((b) => b.client_id === "cli-9").last_seen_at).toBeTruthy();
});
