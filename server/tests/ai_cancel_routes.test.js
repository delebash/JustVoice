// SPDX-License-Identifier: MIT
// A client that leaves stops the model's call (the kit's signal, 2026-10-21; TASKS "Round 7's
// answers acted on", 5): every AI route that keeps nothing of an answer nobody waits for passes
// its request's own signal (`c.req.raw.signal` — @hono/node-server aborts it when the connection
// closes before the answer) and answers 499, as the kit's /v1/ai/run does, never a 500 in the log.
// Each route here is sent a request that leaves once the model's call has started; a route whose
// call was given no signal answers before the client leaves, and its test fails by name.
import { abortError } from "@delebash/core/llm";
import { afterEach, expect, test, vi } from "vitest";
import { Block, Scene, Speaker } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as run from "../src/engines/llm/run.js";
import * as mergeNames from "../src/extraction/merge_names.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

/** A model call held until its signal aborts — `entered` hears it start, `stopped` its abort. */
function heldCall(signal, model) {
  model.entered();
  if (!signal) return Promise.reject(new Error("the model's call was given no signal"));
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        model.stopped = true;
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

function holdTheModel() {
  const model = { stopped: false };
  model.inCall = new Promise((resolve) => {
    model.entered = resolve;
  });
  vi.spyOn(run, "measureFeature").mockResolvedValue(null);
  vi.spyOn(run, "runFeature").mockImplementation((_action, _variables, _overrides, opts) => heldCall(opts?.signal, model));
  vi.spyOn(run, "streamFeature").mockImplementation((_action, _variables, _overrides, opts) => heldCall(opts?.signal, model));
  return model;
}

/** Send the request; leave once the model's call has started — a stream's client by cancelling
 * the stream, any other by its request's signal, answered 499. */
async function leaveMidCall(app, model, method, url, json) {
  const stream = url.endsWith("/stream");
  const leave = new AbortController();
  const pending = app.request(
    url,
    { method, headers: { "content-type": "application/json" }, body: json === undefined ? undefined : JSON.stringify(json), signal: leave.signal },
    { incoming: { socket: { remoteAddress: "127.0.0.1" } } },
  );
  const answered = stream ? new Promise(() => {}) : pending.then(async (r) => `answered ${r.status}: ${await r.text()}`);
  expect(await Promise.race([model.inCall.then(() => "in the call"), answered]), url).toBe("in the call");
  if (stream) await (await pending).body.cancel();
  else {
    leave.abort();
    expect((await pending).status, url).toBe(499);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(model.stopped, url).toBe(true);
}

/** A book with one chapter whose line Mara speaks, and Mara's id. */
async function book(c) {
  const json = bookJson({ chapters: [["ch1", "One", [scene("scn1", "“Hello,” said Mara. The rain kept on.")]]] });
  const r = await c.post("/v1/projects/import?source=justwrite", { json });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const sceneId = (await c.get(`/v1/projects/${pid}/scenes`)).json()[0].id;
  const mara = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.find((s) => s.name === "Mara Vance");
  return { pid, sceneId, mara };
}

test("the Lab's analyze, direction and discover runs", async () => {
  const { app } = await appClient(undefined, { seed: true });
  const text = "“Hi,” said Mara sadly.";
  for (const [url, json] of [
    ["/v1/extraction/analyze-text", { text, characters: [{ id: "mara", name: "Mara" }] }],
    ["/v1/extraction/direction-text", { text, speakers: { 0: "Mara" } }],
    ["/v1/extraction/discover-speakers", { text }],
  ]) {
    vi.restoreAllMocks();
    await leaveMidCall(app, holdTheModel(), "POST", url, json);
  }
});

test("Smart-assign, the voices' gender guess, the refine Lab", async () => {
  const { app } = await appClient(undefined, { seed: true });
  for (const [url, json] of [
    ["/v1/llm/smart-assign", { characters: [{ id: "s1", name: "Alice" }], voices: [{ id: "v1", name: "Bella" }], apply: true }],
    ["/v1/voices/gender-guess", { voices: [{ name: "Mystery" }] }],
    ["/v1/refine/lab-run", { transcript: "um hello there" }],
  ]) {
    vi.restoreAllMocks();
    await leaveMidCall(app, holdTheModel(), "POST", url, json);
  }
});

test("a persona's Compose and Rewrite, and a speaker's Rewrite as them", async () => {
  const { app, c } = await appClient(undefined, { seed: true });
  const persona = (await c.post("/v1/personas", { json: { name: "Gentle", voice_id: "af_heart", note: "soft and quick" } })).json().id;
  const { mara } = await book(c);
  expect((await c.patch(`/v1/speakers/${mara.id}`, { json: { description: "A tired sea captain." } })).status).toBe(200);
  for (const [url, json] of [
    [`/v1/personas/${persona}/compose`, undefined],
    [`/v1/personas/${persona}/rewrite`, { text: "Hello there." }],
    [`/v1/speakers/${mara.id}/rewrite`, { text: "Hello there." }],
  ]) {
    vi.restoreAllMocks();
    await leaveMidCall(app, holdTheModel(), "POST", url, json);
  }
});

test("a book's show notes, its voices' descriptions and the merge of its names", async () => {
  const { app, c } = await appClient(undefined, { seed: true });
  const { pid, sceneId, mara } = await book(c);
  // Mara speaks the chapter's line, and one line is enough for a voice of her own.
  session.getDb().run(`update ${Block} set speaker_id = ? where scene_id = ?`, [mara.id, sceneId]);
  expect((await c.patch("/v1/settings", { json: { book_voices: { min_lines: 1 } } })).status).toBe(200);
  for (const url of [`/v1/projects/${pid}/show-notes`, `/v1/projects/${pid}/book-voices/describe`]) {
    vi.restoreAllMocks();
    await leaveMidCall(app, holdTheModel(), "POST", url, url.endsWith("describe") ? {} : undefined);
  }
  // One chapter's names share no words, so the merge asks no model: it is held a level up (its
  // own call is merge_names.test.js's).
  vi.restoreAllMocks();
  const model = holdTheModel();
  vi.spyOn(mergeNames, "mergeBook").mockImplementation((_found, opts) => heldCall(opts?.signal, model));
  await leaveMidCall(app, model, "POST", `/v1/projects/${pid}/speakers/merge`);
});

test("Cancel means cancel on Discover's scan, direction, the lines with no single speaker and the match", async () => {
  // Decided 2026-10-21: these keep their answer, so a client that leaves now loses the call's work —
  // the rule Analyze has. Each is left mid-call, and nothing is written.
  const { app, c } = await appClient(undefined, { seed: true });
  const { pid, sceneId, mara } = await book(c);
  const h = session.getDb();
  const chapter = () => [h.get(Scene, sceneId).metadata_json, h.all(`select speaker_id, direction from ${Block} where scene_id = ? order by position`, [sceneId])];

  // Discover's scan: the chapter keeps no scan.
  let before = chapter();
  await leaveMidCall(app, holdTheModel(), "POST", `/v1/scenes/${sceneId}/discover-speakers`, { text: "“Hello,” said Mara. The rain kept on." });
  expect(chapter()).toEqual(before);

  // Direction, on a chapter whose every line has a speaker: no line gets one.
  vi.restoreAllMocks();
  h.run(`update ${Block} set speaker_id = ? where scene_id = ?`, [mara.id, sceneId]);
  before = chapter();
  await leaveMidCall(app, holdTheModel(), "POST", `/v1/scenes/${sceneId}/direction`, {});
  expect(chapter()).toEqual(before);

  // The lines with no single speaker, on an analyzed chapter whose spoken line has none: it stays blank.
  vi.restoreAllMocks();
  h.run(`update ${Scene} set metadata_json = ? where id = ?`, ['{"analyzed_at": "2026-10-21T00:00:00"}', sceneId]);
  h.run(`update ${Block} set speaker_id = null, source = 'llm' where scene_id = ?`, [sceneId]);
  before = chapter();
  await leaveMidCall(app, holdTheModel(), "POST", `/v1/scenes/${sceneId}/group-lines`);
  expect(chapter()).toEqual(before);

  // The match: Mara, still without a persona, stays so.
  vi.restoreAllMocks();
  expect((await c.patch(`/v1/projects/${pid}`, { json: { language: "en" } })).status).toBe(200);
  expect((await c.post("/v1/personas", { json: { name: "Gentle", voice_id: "af_heart", note: "soft and quick" } })).status).toBe(201);
  await leaveMidCall(app, holdTheModel(), "POST", `/v1/projects/${pid}/book-voices/match`);
  expect(h.get(Speaker, mara.id).persona_id).toBeNull();
});

test("Script's 🔎 Second look stops the question it is asking", async () => {
  const { app, c } = await appClient(undefined, { seed: true });
  const { sceneId } = await book(c);
  // Mara's line left with no speaker — what the second look asks about.
  const h = session.getDb();
  h.run(`update ${Block} set speaker_id = null where scene_id = ?`, [sceneId]);
  await leaveMidCall(app, holdTheModel(), "POST", `/v1/scenes/${sceneId}/second-look/stream`, {});
});
