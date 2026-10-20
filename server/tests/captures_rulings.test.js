// SPDX-License-Identifier: MIT
// The dictation backend's fixes of 2026-10-08 (the clean-room rewrite's rulings):
//   16 — a capture whose transcription fails leaves no recording behind;
//   17 — re-cleaning a capture with no language model set up answers 501, as the refine Lab does;
//   19 — a capture's duration_ms is written, from the WAV's header.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { LLMNotConfiguredError } from "@delebash/core/llm";
import { afterEach, expect, test, vi } from "vitest";
import * as captures from "../src/api/captures_api.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as run from "../src/engines/llm/run.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const silence = (seconds, rate) => writeWavContainer(Buffer.alloc(Math.round(seconds * rate) * 2), rate, 1);
const upload = (buf) => ({ files: { file: ["take.wav", buf, "audio/wav"] }, data: { source: "mic" } });

test("a_failed_transcription_keeps_no_recording", async () => {
  const { c, dir } = await appClient();
  vi.spyOn(captures, "_sttTranscribe").mockRejectedValue(new Error("recognizer crashed"));
  const r = await c.post("/v1/captures", upload(silence(0.5, 16000)));
  expect(r.status).toBe(500);
  const folder = path.join(dir, "captures");
  expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
  expect((await c.get("/v1/captures")).json().total).toBe(0);
});

test("recleaning_without_a_language_model_answers_501", async () => {
  const { c } = await appClient(undefined, { seed: true });
  vi.spyOn(captures, "_sttTranscribe").mockResolvedValue("um hello world");
  const settings = { json: { captures: { auto_refine: false } } };
  expect((await c.patch("/v1/settings", settings)).status).toBe(200);
  const row = (await c.post("/v1/captures", upload(silence(0.5, 16000)))).json();
  vi.spyOn(run, "runFeature").mockRejectedValue(new LLMNotConfiguredError("no LLM provider registered"));
  const r = await c.post(`/v1/captures/${row.id}/refine`, { json: {} });
  expect(r.status, r.text).toBe(501);
  expect(r.json().detail).toContain("no LLM provider registered");
  // Nothing was overwritten.
  expect((await c.get(`/v1/captures/${row.id}`)).json().transcript).toBe("um hello world");
});

test("recleaning_while_the_local_model_isnt_ready_answers_503_not_500", async () => {
  // The kit's aiRunHttpError (2026-10-20): a local engine or model that isn't ready is a 503 in the
  // runner's words, a provider that can't be reached a 502 — it was a bare 500.
  const { c } = await appClient(undefined, { seed: true });
  vi.spyOn(captures, "_sttTranscribe").mockResolvedValue("um hello world");
  expect((await c.patch("/v1/settings", { json: { captures: { auto_refine: false } } })).status).toBe(200);
  const row = (await c.post("/v1/captures", upload(silence(0.5, 16000)))).json();
  vi.spyOn(run, "runFeature").mockRejectedValue(Object.assign(new Error("the local engine isn't installed"), { localNotReady: true }));
  let r = await c.post(`/v1/captures/${row.id}/refine`, { json: {} });
  expect(r.status, r.text).toBe(503);
  expect(r.json().type.endsWith("/engine-not-ready")).toBe(true);
  vi.spyOn(run, "runFeature").mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { unreachable: true }));
  r = await c.post(`/v1/captures/${row.id}/refine`, { json: {} });
  expect(r.status, r.text).toBe(502);
  expect((await c.get(`/v1/captures/${row.id}`)).json().transcript).toBe("um hello world");
});

test("a_capture_records_its_length", async () => {
  const { c } = await appClient();
  vi.spyOn(captures, "_sttTranscribe").mockResolvedValue("hello");
  const settings = { json: { captures: { auto_refine: false } } };
  expect((await c.patch("/v1/settings", settings)).status).toBe(200);
  const r = await c.post("/v1/captures", upload(silence(0.75, 24000)));
  expect(r.status, r.text).toBe(201);
  expect(r.json().duration_ms).toBe(750);
  // Something that is not a WAV this app reads has no length, and is still kept.
  const odd = await c.post("/v1/captures", upload(Buffer.from("RIFF0000WAVEfmt ")));
  expect(odd.status).toBe(201);
  expect(odd.json().duration_ms).toBeNull();
});
