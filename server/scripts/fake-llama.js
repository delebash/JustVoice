// SPDX-License-Identifier: MIT
// A FAKE llama-server for the extraction checks (compare-extraction.js, compare-analyze-routes.js):
// a Node HTTP server on a free loopback port answering `GET /v1/models` (the given models, a
// 3,000-token context), `/apply-template`, `/tokenize` (a token per 4 characters) and
// `/v1/chat/completions` (JSON, or SSE with a prompt-progress frame, a thinking frame and the
// answer in chunks). Its answers are derived from the request — attribution answers per [D#]
// (some by name, some unknown, some below the floor, some missing, some wrapped in prose),
// second-look answers per marked line, Discover's names from the manuscript — so equal requests
// get equal answers. It records every request's method, path and body text. No model is loaded.

import { createServer } from "node:http";

export const CTX = 3000;

/** A small deterministic hash of a string. */
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7);
const cps = (s) => [...s].length;

/** The answer a request gets — derived from what it asks, nothing else. */
export function answerFor(body) {
  const msgs = body.messages || [];
  const sys = msgs
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const user = msgs
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n");
  if (sys.includes("casting assistant") || user.includes("Manuscript text:")) {
    const known = new Set([...user.matchAll(/^- ([^(\n—]+)/gm)].map((m) => m[1].trim().toLowerCase()));
    const manuscript = user.split("Manuscript text:").pop();
    const names = [];
    for (const m of manuscript.matchAll(/\b([A-Z][a-z]{3,})\b/g)) {
      const n = m[1];
      if (!known.has(n.toLowerCase()) && !names.includes(n)) names.push(n);
      if (names.length >= 3) break;
    }
    const arr = names.map((n, i) => ({ name: i === 2 ? n.toUpperCase() : n, role_hint: i ? "someone in the text" : "", approx_lines: i === 1 ? 2.0 : i, evidence: `${n} was there` }));
    const json = JSON.stringify(arr);
    return hash(manuscript) % 2 ? `\`\`\`json\n${json}\n\`\`\`\nThose are all.` : json;
  }
  if (sys.includes("You attribute ONE line") || user.includes("Who speaks the marked line")) {
    const cast = [...user.matchAll(/^- id="([^"]+)", name="([^"]+)"/gm)].map((m) => [m[1], m[2]]);
    const line = /⟦([^⟧]*)⟧\?/.exec(user)?.[1] ?? "";
    const k = hash(line) % (cast.length + 3);
    if (k < cast.length) return JSON.stringify({ reason: "The text names them.", speaker: cast[k][0], confidence: 0.9 });
    if (k === cast.length) return `Thinking aloud. {"reason": "Someone new.", "speaker": "unknown", "confidence": 0.5, "not_in_cast": "Captain Vire"}`;
    if (k === cast.length + 1) return JSON.stringify({ reason: "Unsure.", speaker: cast[0]?.[1] ?? "unknown", confidence: 0.3 });
    return "no json at all";
  }
  if (user.includes("[D")) {
    const ids = [...new Set([...user.matchAll(/\[D(\d+)\]/g)].map((m) => Number(m[1])))];
    const cast = [...user.matchAll(/^- id="([^"]+)", name="([^"]+)"/gm)].map((m) => [m[1], m[2]]);
    const confs = [0.95, 0.6, 0.35, 0.8, 1, 0.72];
    const picks = [];
    for (const n of ids) {
      if (n % 11 === 5) continue; // a gap
      const k = (n * 7 + 3) % (cast.length + 2);
      const speaker = k < cast.length ? cast[k][0] : k === cast.length ? "unknown" : (cast[n % Math.max(1, cast.length)]?.[1] ?? "unknown");
      const id = n % 9 === 4 ? `[D${n}]` : n % 13 === 6 ? n : `D${n}`;
      picks.push({ id, speaker, confidence: confs[n % confs.length] });
    }
    const json = JSON.stringify(picks);
    return ids.length % 2 ? json : `Checking [D${ids[0]}] first.\n${json}\nDone.`;
  }
  return "OK";
}

/** A fake llama-server recording every request → `{port, log, server}` (close `server` when
 * done). `models` are what `GET /v1/models` lists. */
export function fakeServer(models) {
  const log = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      log.push({ method: req.method, path: req.url, body: raw });
      const send = (obj) => {
        const text = JSON.stringify(obj);
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
        res.end(text);
      };
      if (req.method === "GET" && req.url === "/v1/models") return send({ data: models.map((id) => ({ id, meta: { n_ctx: CTX } })) });
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === "/apply-template") return send({ prompt: (body.messages || []).map((m) => `<|${m.role}|>\n${m.content}`).join("\n") });
      if (req.url === "/tokenize") return send({ tokens: Array.from({ length: Math.ceil(cps(body.content || "") / 4) }, (_, i) => i % 1000) });
      if (req.url === "/v1/chat/completions") {
        const content = answerFor(body);
        const pt = Math.ceil(cps(JSON.stringify(body.messages || [])) / 4);
        const ct = Math.ceil(cps(content) / 4);
        if (!body.stream) {
          return send({ model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: pt, completion_tokens: ct } });
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        frame({ choices: [], prompt_progress: { total: 100, processed: 40 } });
        frame({ choices: [{ index: 0, delta: { reasoning_content: "Let me read the lines." } }] });
        for (let i = 0; i < content.length; i += 17) frame({ choices: [{ index: 0, delta: { content: content.slice(i, i + 17) } }] });
        frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        frame({ choices: [], usage: { prompt_tokens: pt, completion_tokens: ct } });
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"not found"}');
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, log, server })));
}
