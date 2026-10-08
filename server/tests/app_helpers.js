// SPDX-License-Identifier: MIT
// The ONE way a test builds the real app — Python's `TestClient(create_app(data_dir=tmp_path))`
// (+ `seed_workspace()` where the test called it). Every API test (the API wave's three agents)
// uses it:
//
//   import { appClient, closeApps } from "./app_helpers.js";
//   afterEach(closeApps);
//   const { c, app, dir } = await appClient();            // a fresh temp data dir
//   const { c } = await appClient(dir, { seed: true });   // + seedWorkspace(), on a dir
//   const r = await c.post("/v1/channels", { json: { name: "A" } });
//   expect(r.status).toBe(201); expect(r.json().name).toBe("A");
//   await c.post("/v1/captures", { files: { file: ["a.wav", buf, "audio/wav"] }, data: { source: "upload" } });
//   client(app, { remoteAddress: "192.168.1.20" })        // TestClient(app, client=(host, port))
//
// Requests go through Fastify's `inject` (no socket, no port). `closeApps()` closes every app
// built since the last call (its onClose stops MCP sessions, the engine manager and the DSP
// program), then forgets the module database and the app state — the next test starts clean.
import { multipart } from "@delebash/llm-runner/platform/http";
import "./helpers.js"; // the sandboxed family registry + user cache (JUST_AI_HOME, LLM_RUNNER_CACHE)
import { createApp } from "../src/app.js";
import { cfg as appCfg } from "../src/app_state.js";
import { seedWorkspace } from "../src/database/seed.js";
import * as session from "../src/database/session.js";
import { tmpPath } from "./helpers.js";

// npm run dev names its audio.cpp build in this variable; the suite tests the pinned release.
delete process.env.JUSTVOICE_AUDIOCPP_BUILD;

const open = [];

/** createApp(dir) (+ seedWorkspace when `seed`), ready to take requests. */
export async function makeApp(dir = tmpPath(), { seed = false } = {}) {
  const app = await createApp(dir);
  if (seed) await seedWorkspace();
  await app.ready();
  open.push(app);
  return app;
}

/** The answer, read the way a TestClient response reads. */
function answer(r) {
  return {
    status: r.statusCode,
    headers: r.headers,
    text: r.body,
    content: r.rawPayload,
    json: () => JSON.parse(r.body),
  };
}

/**
 * A TestClient over `app`: get/post/put/patch/delete(url, {json, files, data, headers, query}).
 * `files` = {name: [filename, Buffer, contentType]} and `data` = {name: value} are sent as
 * multipart/form-data (httpx's `files=` / `data=`); `json` as application/json.
 * `remoteAddress` is the client's address (TestClient's `client=(host, port)`).
 */
export function client(app, { remoteAddress = "127.0.0.1" } = {}) {
  const send = async (method, url, { json, files, data, headers = {}, body } = {}) => {
    const opts = { method, url, headers: { ...headers }, remoteAddress };
    if (files !== undefined || data !== undefined) {
      const parts = [];
      for (const [name, v] of Object.entries(data || {})) parts.push({ name, data: String(v) });
      for (const [name, [filename, buf, contentType]] of Object.entries(files || {})) parts.push({ name, filename, data: buf, contentType });
      const mp = multipart(parts);
      opts.payload = mp.body;
      opts.headers["content-type"] = mp.contentType;
    } else if (json !== undefined) {
      opts.payload = JSON.stringify(json);
      opts.headers["content-type"] ??= "application/json";
    } else if (body !== undefined) {
      opts.payload = body;
    }
    return answer(await app.inject(opts));
  };
  return {
    get: (url, o) => send("GET", url, o),
    post: (url, o) => send("POST", url, o),
    put: (url, o) => send("PUT", url, o),
    patch: (url, o) => send("PATCH", url, o),
    delete: (url, o) => send("DELETE", url, o),
    options: (url, o) => send("OPTIONS", url, o),
  };
}

/** `{app, c, dir}` — a fresh app on `dir` (a new temp folder by default) and its client. */
export async function appClient(dir = tmpPath(), { seed = false, remoteAddress } = {}) {
  const app = await makeApp(dir, { seed });
  return { app, c: client(app, { remoteAddress }), dir };
}

/** Close every app built since the last call, then forget the module database and state. */
export async function closeApps() {
  for (const app of open.splice(0)) {
    try {
      await app.close();
    } catch {
      /* already closed */
    }
  }
  session.closeDb();
  session.cfg.dbPath = null;
  appCfg.state = null;
}
