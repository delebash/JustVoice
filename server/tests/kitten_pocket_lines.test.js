// SPDX-License-Identifier: MIT
// KittenTTS and Pocket TTS requests and the Kyutai terms gate (decided 2026-10-02 — docs/plans/
// 2026-10-02-cpu-placement.md §8, where both engines came in with the CPU placement). Since round E
// (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime decides where every
// speech model runs, books its memory and runs its servers, and tests that; what stays here is
// ours: each family's request (its voice names, its speed, a clone from its clip, a line in a
// language it doesn't speak refused by name), the presets Pocket TTS offers, a Pocket clone refused
// before anything loads until Kyutai's terms are accepted (slot.js `checkLine`), a line the model
// can't take answered as a bad request (slot.js `speak`, seen 2026-10-16), and the terms on the
// engine list (the port of tests/test_cpu_placement.py).
import { afterEach, expect, test, vi } from "vitest";
import { endSpeech, fakeServer, fakeSpeechRuntime } from "./engines_helpers.js";
import { variantOf } from "../src/engines/audiocpp/kit_models.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { discoverEngines, TermsRequired } from "../src/engines/model_catalog.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(async () => {
  endSpeech();
  await closeApps();
});

// ─── KittenTTS and Pocket TTS requests ──────────────────────────────────────

const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);

test("kitten_takes_its_own_voice_name_and_speed", () => {
  const req = slot.toSpeechRequest(row("kitten", "kitten-mini-0.8"), { text: "Hi.", voice_id: "kitten_bella", delivery: { speed: 1.2 } });
  expect([req.voice, req.speed, req.model]).toEqual(["Bella", 1.2, "kitten-mini-0.8"]);
});

test("pocket_speaks_a_preset_or_clones_from_the_clip", () => {
  const r = row("pocket", "pocket-en-q8");
  expect(slot.toSpeechRequest(r, { text: "Hi.", voice_id: "pocket_bill_boerst" }).voice).toBe("bill_boerst");
  const req = slot.toSpeechRequest(r, { text: "Hi.", audio_prompt_path: "C:\\v\\ref.wav", seed: 3 });
  expect(req.voice_ref).toBe("C:/v/ref.wav");
  expect("voice" in req).toBe(false);
  expect(req.seed).toBe(3);
});

test("pocket_refuses_a_line_in_another_language_by_name", () => {
  const r = row("pocket", "pocket-en-q8");
  expect(() => slot.toSpeechRequest(r, { text: "Hallo.", voice_id: "pocket_alba", language: "de-DE" })).toThrow(
    /speaks English.*German.*load the German Pocket TTS model/,
  );
  // Its own language, any region, is fine.
  expect(slot.toSpeechRequest(r, { text: "Hi.", voice_id: "pocket_alba", language: "en-GB" })).toBeTruthy();
});

test("pocket_offers_only_the_presets_licensed_for_commercial_use", () => {
  const voices = new Set(discoverEngines().get("pocket").staticVoices.map((v) => v.id));
  expect(voices.size).toBe(20);
  for (const v of ["pocket_cosette", "pocket_jean", "pocket_giovanni", "pocket_lola", "pocket_juergen", "pocket_rafael"]) {
    expect(voices.has(v)).toBe(false);
  }
  for (const r of discoverEngines().get("pocket").module.VARIANTS) {
    const files = r.sources[0].files;
    // French clones only: its package's own cosette comes with it, never offered (TASKS "Slice 4's gaps" 2).
    expect(files.length, r.id).toBe(r.id.startsWith("pocket-fr-") ? 2 : 21);
    expect(files[0].endsWith(".gguf")).toBe(true);
  }
});

test("every_new_voice_id_is_unique_across_engines", () => {
  const seen = new Map();
  for (const [eid, m] of discoverEngines()) {
    for (const v of m.staticVoices) {
      expect(seen.has(v.id), `${v.id} is both ${seen.get(v.id)} and ${eid}`).toBe(false);
      seen.set(v.id, eid);
    }
  }
});

// ─── Kyutai's terms, and a line the model can't take ───────────────────────

test("a_pocket_clone_waits_for_kyutais_terms", async () => {
  // Refused before anything loads (slot.js `checkLine`), as the 403 the app shows the terms for.
  vi.spyOn(slot, "termsAccepted").mockReturnValue(false);
  const found = variantOf("pocket-en-q8");
  let refused = null;
  try {
    slot.checkLine(found, { text: "Hi.", audio_prompt_path: "/v/ref.wav" });
  } catch (e) {
    refused = e;
  }
  expect(refused).toBeInstanceOf(TermsRequired);
  expect(refused.message).toContain("Kyutai");
  expect(refused.apiError()).toMatchObject({ statusCode: 403, slug: "terms-required", extra: { engine: "pocket" } });
  // A preset needs no terms.
  expect(slot.checkLine(found, { text: "Hi.", voice_id: "pocket_alba" })).toBeUndefined();
  // A line reaches its caller as the same refusal, and nothing loads.
  const svc = fakeSpeechRuntime();
  await expect(kitSpeech.speak("pocket", "pocket-en-q8", { text: "Hi.", audio_prompt_path: "/v/ref.wav" })).rejects.toBeInstanceOf(TermsRequired);
  expect(svc.lines).toEqual([]);
});

test("an_accepted_pocket_clone_renders", async () => {
  vi.spyOn(slot, "termsAccepted").mockReturnValue(true);
  const svc = fakeSpeechRuntime();
  await kitSpeech.speak("pocket", "pocket-en-q8", { text: "Hi.", audio_prompt_path: "/v/ref.wav" });
  expect(svc.lines.map((l) => l.modelId)).toEqual(["pocket-en-q8"]);
  expect(svc.server.calls[0][1].voice_ref).toBe("/v/ref.wav");
});

test("a_line_the_model_cant_take_is_refused_as_a_bad_request_not_an_internal_error", async () => {
  // Seen through the app 2026-10-16: Pocket TTS French's preset refusal answered 500.
  const server = fakeServer();
  const words = "Pocket TTS French speaks only cloned voices — this voice has no reference clip";
  await expect(slot.speak(server, row("pocket", "pocket-fr-q8"), { text: "Bonjour.", language: "fr", voice_id: "pocket_alba" })).rejects.toMatchObject({
    status: 400,
    message: words,
  });
  expect(server.calls).toEqual([]);
  // Through a line: the 400 the routes answer, in audio.cpp's words.
  fakeSpeechRuntime({ server });
  const e = await kitSpeech.speak("pocket", "pocket-fr-q8", { text: "Bonjour.", language: "fr", voice_id: "pocket_alba" }).catch((x) => x);
  expect(e).toBeInstanceOf(kitSpeech.EngineRequestError);
  expect(e.apiError()).toMatchObject({ statusCode: 400, detail: `engine synth failed: ${words}` });
  expect(server.calls).toEqual([]);
});

// ─── the API ────────────────────────────────────────────────────────────────

test("pocket_shows_its_terms_until_accepted", async () => {
  const { c } = await appClient();
  const engine = async (id) => (await c.get("/v1/engines")).json().engines.find((e) => e.id === id);
  let eng = await engine("pocket");
  expect(eng.terms.owner).toBe("Kyutai");
  expect(eng.terms.gates).toBe("cloning");
  expect(eng.terms.text).toContain("voice impersonation or cloning without explicit and lawful consent");
  expect(eng.terms_accepted).toBe(false);
  const r = await c.post("/v1/engines/pocket/terms");
  expect(r.status).toBe(200);
  expect(r.json().accepted).toBe(true);
  expect(r.json().at).toBeTruthy();
  eng = await engine("pocket");
  expect(eng.terms_accepted).toBe(true);
  // An engine without terms has nothing to accept.
  expect((await c.post("/v1/engines/kokoro/terms")).status).toBe(400);
  expect((await engine("kokoro")).terms).toBeNull();
});
