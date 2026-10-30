// SPDX-License-Identifier: MIT
// An AI route that can't reach its model answers as the kit's /v1/ai/run does (the kit's aiRunHttpError,
// 2026-10-20): 503 engine-not-ready when the local engine or model isn't ready, 502 provider-unreachable when
// the provider can't be reached — Smart-assign, a speaker's Rewrite and the voices' gender guess answered
// their own 502 (or a 500) for both.
import { afterEach, expect, test, vi } from "vitest";
import * as run from "../src/engines/llm/run.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

const NOT_READY = () => Object.assign(new Error("the local engine isn't installed"), { localNotReady: true });
const UNREACHABLE = () => Object.assign(new Error("connect ECONNREFUSED"), { unreachable: true });

test("Smart-assign, a speaker's Rewrite and the gender guess answer 503 for a model not ready, 502 for a provider not reached", async () => {
  const { c } = await appClient(undefined, { seed: true });
  const json = bookJson({ chapters: [["ch1", "One", [scene("scn1", "“Hello,” said Mara. The rain kept on.")]]] });
  const pid = (await c.post("/v1/projects/import?source=justwrite", { json })).json().project_id;
  const mara = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.find((s) => s.name === "Mara Vance");
  expect((await c.patch(`/v1/speakers/${mara.id}`, { json: { description: "A tired sea captain." } })).status).toBe(200);

  for (const [url, body] of [
    ["/v1/llm/smart-assign", { characters: [{ id: "s1", name: "Alice" }], voices: [{ id: "v1", name: "Bella" }], apply: false }],
    [`/v1/speakers/${mara.id}/rewrite`, { text: "Hello there." }],
    ["/v1/voices/gender-guess", { voices: [{ name: "Mystery" }] }],
  ]) {
    vi.spyOn(run, "runFeature").mockRejectedValue(NOT_READY());
    let r = await c.post(url, { json: body });
    expect(r.status, `${url}: ${r.text}`).toBe(503);
    expect(r.json().type.endsWith("/engine-not-ready"), url).toBe(true);
    vi.spyOn(run, "runFeature").mockRejectedValue(UNREACHABLE());
    r = await c.post(url, { json: body });
    expect(r.status, `${url}: ${r.text}`).toBe(502);
    expect(r.json().type.endsWith("/provider-unreachable"), url).toBe(true);
  }
});
