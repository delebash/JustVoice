// SPDX-License-Identifier: MIT
// The client API's contract (docs/dev/client-api.md): every route against the example bodies in
// tests/fixtures/client-api/, which a calling app's fake copies (JustDirect, 2026-11-08). A route's
// answer must carry every field its example shows, of the same type — so a field renamed or dropped
// here fails this suite before it breaks the caller.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as clientApi from "../src/api/client_api.js";
import * as generateApi from "../src/api/generate_api.js";
import * as vp from "../src/api/voice_preview_api.js";
import { getState } from "../src/app_state.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as run from "../src/engines/llm/run.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  return closeApps();
});

const FIX = path.join(import.meta.dirname, "fixtures", "client-api");
const fixture = (name) => JSON.parse(readFileSync(path.join(FIX, name), "utf8"));
const CLIENT = { "X-Client": "JustDirect" };

function toneWav(seconds = 0.5, sampleRate = 24000) {
  const n = Math.trunc(seconds * sampleRate);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 6000), 2 * i);
  return writeWavContainer(pcm, sampleRate, 1);
}

/** Every field of `example` is in `actual`, with the same JSON type (objects compared inside). */
function hasShape(actual, example, where = "") {
  for (const [k, v] of Object.entries(example)) {
    expect(Object.hasOwn(actual ?? {}, k), `${where}${k} missing from ${JSON.stringify(actual).slice(0, 300)}`).toBe(true);
    const a = actual[k];
    if (v === null || a === null) continue;
    if (Array.isArray(v)) {
      expect(Array.isArray(a), `${where}${k} is a list`).toBe(true);
      if (v.length && typeof v[0] === "object" && a.length) hasShape(a[0], v[0], `${where}${k}[0].`);
    } else if (typeof v === "object") hasShape(a, v, `${where}${k}.`);
    else expect(typeof a, `${where}${k}'s type`).toBe(typeof v);
  }
}

async function ended(c, id) {
  for (let i = 0; i < 400; i++) {
    const r = await c.get(`/v1/jobs/${id}`);
    const job = r.json();
    if (job.state !== "running") return job;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error(`job ${id} still running`);
}

/** A sellable design and cast model, as the commercial default sets them. */
async function sellable(c) {
  const r = await c.patch("/v1/settings", { json: { book_voices: { design_model: "qwen3-vd", clone_model: "voxcpm2" } } });
  expect(r.status, r.text).toBe(200);
}

test("health_names_the_client_api_version", async () => {
  const { c } = await appClient();
  const r = await c.get("/v1/health");
  expect(r.json().client_api).toBe(1);
});

test("a_character_voice_is_described_designed_and_kept_on_the_cast_model_as_the_example_shows", async () => {
  const { c } = await appClient();
  await sellable(c);
  const described = vi.spyOn(run, "runFeature").mockResolvedValue({ text: JSON.stringify({ gender: "male", description: "Male, fifties, low and slow." }), model: "gemma-test" });
  const heard = [];
  vi.spyOn(vp, "synthCandidate").mockImplementation(async (body, _engine, kw) => {
    heard.push([body, kw]);
    return [toneWav(), 24000, 1];
  });
  const body = fixture("character-voice.request.json");
  const r = await c.post("/v1/character-voices", { json: body, headers: CLIENT });
  expect(r.status, r.text).toBe(202);
  const job = await ended(c, r.json().id);
  expect(job.state, JSON.stringify(job.error)).toBe("done");
  hasShape(job.result, fixture("character-voice.result.json"));
  // Described by the one-click run's own prompt, over the card and the lines.
  const [action, vars] = described.mock.calls[0];
  expect(action).toBe("book_voices.speaker");
  expect(vars.speaker).toContain("Inspector Maigret");
  expect(vars.passages).toContain("We have all night");
  // Designed speaking the calm line (no "!"), kept on the cast model, marked as the caller's.
  expect(heard[0][1].text).toBe(body.lines[0]);
  expect(job.result.description).toBe("Male, fifties, low and slow.");
  expect([job.result.design.model, job.result.clone.model, job.result.clone.commercial]).toEqual(["qwen3-vd", "voxcpm2", "Yes"]);
  const v = getState().voices.get(job.result.voice_id);
  expect([v.model, v.made_by]).toEqual(["voxcpm2", "JustDirect"]);
  const clip = await c.get(job.result.audition_url);
  expect([clip.status, clip.headers["content-type"]]).toEqual([200, "audio/wav"]);
});

test("commercial_use_refuses_a_model_you_cant_sell_with_before_any_job_starts", async () => {
  const { c } = await appClient();
  await c.patch("/v1/settings", { json: { book_voices: { clone_model: "breeze_tts" } } });
  const r = await c.post("/v1/character-voices", { json: fixture("character-voice.request.json"), headers: CLIENT });
  expect(r.status, r.text).toBe(409);
  expect(r.json().detail).toContain("BreezeTTS 2");
  expect(r.json().detail).toContain("Separate licence");
  // Without it the same models make a voice, their words shown.
  expect(clientApi.modelFacts("breeze_tts").commercial).toBe("Separate licence");
});

test("with_no_language_model_the_card_goes_to_the_designer_as_written", async () => {
  const { c } = await appClient();
  await sellable(c);
  const { LLMNotConfiguredError } = await import("@delebash/core/llm");
  vi.spyOn(run, "runFeature").mockRejectedValue(new LLMNotConfiguredError("no LLM provider registered"));
  vi.spyOn(vp, "synthCandidate").mockResolvedValue([toneWav(), 24000, 1]);
  const body = { ...fixture("character-voice.request.json"), lines: [] };
  const r = await c.post("/v1/character-voices", { json: body, headers: CLIENT });
  const job = await ended(c, r.json().id);
  expect(job.state, JSON.stringify(job.error)).toBe("done");
  expect([job.result.description, job.result.described_by]).toEqual([body.description, null]);
});

test("a_clone_with_no_engine_goes_on_the_cast_model_and_the_voice_list_filters_by_maker", async () => {
  const { c } = await appClient();
  await sellable(c);
  const ref = toneWav(6).toString("base64");
  const r = await c.post("/v1/voices/clone", { json: { name: "Inspector Maigret", ref_wav_b64: ref, language: "en-US", gender: "male" }, headers: CLIENT });
  expect(r.status, r.text).toBe(201);
  hasShape(r.json(), fixture("voice.row.json"));
  expect([r.json().model, r.json().made_by, r.json().licence.commercial]).toEqual(["voxcpm2", "JustDirect", "Yes"]);
  await c.post("/v1/voices/clone", { json: { engine: "voxcpm2", name: "Someone else", ref_wav_b64: ref } });
  const mine = await c.get("/v1/voices?made_by=JustDirect");
  expect(mine.json().voices.map((v) => v.name)).toEqual(["Inspector Maigret"]);
  const gone = await c.delete(`/v1/voices/${r.json().id}`);
  expect(gone.json()).toEqual({ deleted: true });
});

test("one_line_in_openais_shape_reaches_the_line_renderer_with_its_delivery", async () => {
  const { c } = await appClient();
  const asked = [];
  vi.spyOn(generateApi, "generate").mockImplementation(async (req) => {
    asked.push(req);
    return toneWav();
  });
  const r = await c.post("/v1/audio/speech", { json: fixture("speech.request.json") });
  expect([r.status, r.headers["content-type"]]).toEqual([200, "audio/wav"]);
  expect(asked[0].text).toBe("Nobody leaves this room until I say so.");
  expect(asked[0].delivery).toMatchObject({ emotion: "angry", instruct: "quiet, cold, barely holding back anger" });
  expect(asked[0].seed).toBe(7);
  const mp3 = await c.post("/v1/audio/speech", { json: { ...fixture("speech.request.json"), response_format: "mp3" } });
  expect(mp3.status).toBe(400);
});

test("a_batch_renders_every_line_serves_each_wav_and_the_zip_and_lets_go_of_the_card", async () => {
  const { c } = await appClient();
  vi.spyOn(generateApi, "generate").mockImplementation(async () => toneWav());
  const released = vi.spyOn(clientApi, "releaseSpeech").mockResolvedValue(1);
  const r = await c.post("/v1/audio/speech/batch", { json: fixture("speech-batch.request.json"), headers: CLIENT });
  expect(r.status, r.text).toBe(202);
  const job = await ended(c, r.json().id);
  expect(job.state, JSON.stringify(job.error)).toBe("done");
  hasShape(job.result, fixture("speech-batch.result.json"));
  expect(job.result.lines.map((l) => [l.id, l.error])).toEqual([
    ["sc1-l1", null],
    ["sc1-l2", null],
  ]);
  const wav = await c.get(job.result.lines[1].url);
  expect([wav.status, wav.headers["content-type"]]).toEqual([200, "audio/wav"]);
  const zip = await c.get(`/v1/audio/speech/batch/${job.id}.zip`);
  expect([zip.status, zip.headers["content-type"]]).toEqual([200, "application/zip"]);
  expect(released).toHaveBeenCalledTimes(1);
  // Done with it: deleted, its job forgotten and its files gone.
  expect((await c.delete(`/v1/audio/speech/batch/${job.id}`)).json()).toEqual({ deleted: true });
  expect((await c.get(job.result.lines[1].url)).status).toBe(404);
  expect((await c.get(`/v1/jobs/${job.id}`)).status).toBe(410);
});

test("a_batch_refuses_a_line_id_that_isnt_a_plain_name_or_is_given_twice", async () => {
  const { c } = await appClient();
  const line = fixture("speech-batch.request.json").lines[0];
  for (const lines of [[{ ...line, id: "../x" }], [line, line]]) {
    const r = await c.post("/v1/audio/speech/batch", { json: { lines } });
    expect(r.status, r.text).toBe(400);
  }
});
