// SPDX-License-Identifier: MIT
// /v1/personas/{id}/rewrite — the LLM-rewrite endpoint (the port of
// tests/test_persona_rewrite.py).
//
// The endpoint runs through the SHARED run path (`runFeature` → template row + engine preset +
// dispatch), so the app stands up real shared storage + JV's seeds, and success/failure cases
// register a fake adapter under the preset's `local-llamacpp` id. Python mounted the personas
// router alone over a stand-in state holding one persona; here the whole app runs and the
// persona is written to its store (same id, voice and note).
//
// What the endpoint must guarantee: 400 when text is empty; 404 when the persona doesn't
// exist; 400 when the persona has no note (how it sounds — 2026-09-29); 501 when no LLM
// provider is registered; 502 when the LLM call raises; 200 with {original, rewritten,
// persona_id} on success; the persona's note reaches the system prompt via the template row.
import { getLlmRegistry, LLMResponse } from "@delebash/llm-runner/llm";
import { setEnsureLocalModel } from "@delebash/llm-runner/llm/dispatch";
import { afterEach, expect, test } from "vitest";
import { getState } from "../src/app_state.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(async () => {
  await closeApps();
  getLlmRegistry()._adapters = new Map();
  setEnsureLocalModel(null);
});

/** Registered under the preset's provider id so the run path resolves to it; records the
 * system + user content the rendered row produced. */
class FakeLocalAdapter {
  constructor(respond) {
    this.provider_id = "local-llamacpp";
    this.provider_type = "openai-compat";
    this.default_model = "test-model";
    this.respond = respond;
    this.last = {};
  }

  async chat(messages, { model = null, temperature = 0.7, maxTokens = null, system = null } = {}) {
    this.last = { system, user: messages.at(-1).content, temperature, max_tokens: maxTokens };
    return this.respond(model || this.default_model);
  }

  async models() {
    return [this.default_model];
  }

  async ping() {
    return true;
  }
}

/** The app over real shared-stack storage + JV's seeds; the adapter registry starts empty (the
 * 501 state). */
async function rewriteClient() {
  const { c } = await appClient(undefined, { seed: true });
  getLlmRegistry()._adapters = new Map();
  setEnsureLocalModel(null); // no bundled-runner load in unit tests
  return {
    c,
    setPersona: (note = "Warm, low, unhurried.") =>
      getState().personas.create("Mara", { id: "persona-mara", voice_id: "voice-mara", note, default_delivery: {} }),
    register: (respond) => {
      const adapter = new FakeLocalAdapter(respond);
      getLlmRegistry().register(adapter);
      return adapter;
    },
  };
}

// ─── 1. 404 when persona doesn't exist ──────────────────────────────────

test("rewrite_unknown_persona_404", async () => {
  const rc = await rewriteClient();
  const r = await rc.c.post("/v1/personas/nope/rewrite", { json: { text: "Hello." } });
  expect(r.status).toBe(404);
});

// ─── 2. 400 when text is empty ──────────────────────────────────────────

test("rewrite_empty_text_400", async () => {
  const rc = await rewriteClient();
  rc.setPersona();
  const r = await rc.c.post("/v1/personas/persona-mara/rewrite", { json: { text: "   " } }); // whitespace only
  expect(r.status).toBe(400);
});

// ─── 3. 400 when persona has no note ────────────────────────────────────

test("rewrite_persona_without_a_note_400", async () => {
  const rc = await rewriteClient();
  rc.setPersona(null);
  const r = await rc.c.post("/v1/personas/persona-mara/rewrite", { json: { text: "Hello." } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("no note on how it sounds");
});

// ─── 4. 501 when no LLM provider registered ─────────────────────────────

test("rewrite_no_llm_returns_501", async () => {
  // The registry is empty — the run path's own resolution throws LLMNotConfiguredError.
  const rc = await rewriteClient();
  rc.setPersona();
  const r = await rc.c.post("/v1/personas/persona-mara/rewrite", { json: { text: "Hello." } });
  expect(r.status).toBe(501);
});

// ─── 5. 502 when LLM call raises ────────────────────────────────────────

test("rewrite_llm_failure_returns_502", async () => {
  const rc = await rewriteClient();
  rc.setPersona();
  rc.register(() => {
    throw new Error("LLM provider returned malformed response");
  });
  const r = await rc.c.post("/v1/personas/persona-mara/rewrite", { json: { text: "Hello." } });
  expect(r.status).toBe(502);
});

// ─── 6. 200 success with full response shape ────────────────────────────

test("rewrite_success_returns_original_and_rewritten", async () => {
  const rc = await rewriteClient();
  rc.setPersona();
  rc.register((model) => LLMResponse({ text: "Hey there, friend — fancy seein' you again.", model }));
  const r = await rc.c.post("/v1/personas/persona-mara/rewrite", { json: { text: "Hello again, my friend." } });
  expect(r.status).toBe(200);
  const body = r.json();
  // The StudioView per-block right-click code reads either `text` or `rewritten`.
  expect(body).toHaveProperty("rewritten");
  expect(body.original).toBe("Hello again, my friend.");
  expect(body.rewritten).toBe("Hey there, friend — fancy seein' you again.");
  expect(body.persona_id).toBe("persona-mara");
});

// ─── 7. The template row renders the note into the system ───────────────

test("rewrite_passes_the_note_into_system_prompt", async () => {
  const rc = await rewriteClient();
  rc.setPersona("Boston dialect, dry sarcasm.");
  const adapter = rc.register((model) => LLMResponse({ text: "Rewritten!", model }));
  await rc.c.post("/v1/personas/persona-mara/rewrite", { json: { text: "Hello." } });
  // The row's system template carried the note…
  expect(adapter.last.system).toContain("Boston dialect");
  expect(adapter.last.system).toContain("Rewrite the user's line");
  // …and its {{text}} user half rendered the request text.
  expect(adapter.last.user).toBe("Hello.");
  // The tunables came from the assigned preset (p_voiced_edit), not code.
  expect(Number(adapter.last.temperature)).toBe(0.6);
});
