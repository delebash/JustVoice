// SPDX-License-Identifier: MIT
// POST /v1/voices/gender-guess — the voice_gender feature (F1 Phase 3) (the port of
// tests/test_voice_gender.py).
//
// Explicit-trigger contract (ruling 2): the renderer sends the voices its dictionary could not
// label; the run rides the `voice_gender` template row + its preset; the route maps
// male/female/unknown onto JV's F/M/"" vocabulary. The run goes through the real shared run
// path; only the provider adapter is faked (registered under the preset's `local-llamacpp` id).
import { getLlmRegistry, LLMResponse } from "@delebash/llm-runner/llm";
import { setEnsureLocalModel } from "@delebash/llm-runner/llm/dispatch";
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(async () => {
  await closeApps();
  getLlmRegistry()._adapters = new Map();
  setEnsureLocalModel(null);
});

class FakeLocalAdapter {
  constructor(text) {
    this.provider_id = "local-llamacpp";
    this.provider_type = "openai-compat";
    this.default_model = "m";
    this.text = text;
    this.last = {};
  }

  async chat(messages, { model = null, system = null } = {}) {
    this.last = { system, user: messages.at(-1).content };
    return LLMResponse({ text: this.text, model: model || this.default_model });
  }

  async models() {
    return [this.default_model];
  }

  async ping() {
    return true;
  }
}

async function client() {
  const { c } = await appClient(undefined, { seed: true });
  getLlmRegistry()._adapters = new Map();
  setEnsureLocalModel(null);
  return c;
}

test("gender_guess_maps_contract_to_jv_vocabulary", async () => {
  const c = await client();
  const adapter = new FakeLocalAdapter('{"Marcus": "male", "Finch": "female", "Ryo": "unknown", "Ghost": "female"}');
  getLlmRegistry().register(adapter);
  const r = await c.post("/v1/voices/gender-guess", {
    json: { voices: [{ name: "Marcus", description: "deep narrator" }, { name: "Finch" }, { name: "Ryo" }] },
  });
  expect(r.status, r.text).toBe(200);
  // male/female → M/F, unknown → "" (left unset); names the caller never sent ("Ghost") are
  // dropped — the model can't invent rows.
  expect(r.json().guesses).toEqual({ Marcus: "M", Finch: "F", Ryo: "" });
  // The template row rendered the formatted list into the user turn.
  expect(adapter.last.user).toContain("- Marcus — deep narrator");
  expect(adapter.last.system.toLowerCase()).toContain("voice names");
});

test("gender_guess_501_without_provider_and_empty_ok", async () => {
  const c = await client();
  expect((await c.post("/v1/voices/gender-guess", { json: { voices: [] } })).status).toBe(200);
  const r = await c.post("/v1/voices/gender-guess", { json: { voices: [{ name: "X" }] } });
  expect(r.status).toBe(501);
});
