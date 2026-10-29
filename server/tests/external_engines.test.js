// SPDX-License-Identifier: MIT
// A speech server you run, or a cloud speech API, saved through POST /v1/engines/external takes effect
// at once (AI Settings → Speech, its Self-hosted servers and Online · metered rows —
// SpeechProvidersPanel): registered live with the adapter its `provider_type` names — the one the
// boot builds from settings.engines.external — and saved there; saving it again is its edit, replaced
// in place. An id that isn't one of the saved servers stays refused.
import { afterEach, expect, test } from "vitest";
import { getState } from "../src/app_state.js";
import { EngineMeta } from "../src/engines/base.js";
import { ExternalOpenAiTtsBackend } from "../src/engines/external_openai.js";
import { ElevenLabsBackend } from "../src/engines/tts_providers/elevenlabs.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const ELEVEN = { id: "eleven", name: "ElevenLabs", provider_type: "elevenlabs", base_url: "https://api.elevenlabs.io/v1", api_key: "k1" };
const KOKORO = { id: "kokoro-local", name: "Kokoro server", provider_type: "openai-compat", base_url: "http://localhost:8880", model: "kokoro", self_hosted: true };

test("a saved provider is registered at once with its own adapter, and saving it again is its edit", async () => {
  const { c } = await appClient();
  const st = getState();
  expect((await c.post("/v1/engines/external", { json: ELEVEN })).status).toBe(201);
  expect((await c.post("/v1/engines/external", { json: KOKORO })).status).toBe(201);
  expect(st.engines.get("eleven")).toBeInstanceOf(ElevenLabsBackend);
  expect(st.engines.get("kokoro-local")).toBeInstanceOf(ExternalOpenAiTtsBackend);

  const edited = await c.post("/v1/engines/external", { json: { ...ELEVEN, name: "ElevenLabs (work)", api_key: "k2" } });
  expect(edited.status).toBe(201);
  expect(st.engines.get("eleven").meta.displayName).toBe("ElevenLabs (work)");
  const saved = (await c.get("/v1/settings")).json().engines.external;
  expect(saved.map((e) => [e.id, e.name, e.api_key])).toEqual([
    ["kokoro-local", "Kokoro server", null],
    ["eleven", "ElevenLabs (work)", "k2"],
  ]);

  // Remove: unregistered and unsaved at once
  expect((await c.delete("/v1/engines/external/eleven")).status).toBe(200);
  expect(st.engines.has("eleven")).toBe(false);
  expect((await c.get("/v1/settings")).json().engines.external.map((e) => e.id)).toEqual(["kokoro-local"]);
});

test("an id that isn't one of the saved servers stays refused, and a provider that can't be built changes nothing", async () => {
  const { c } = await appClient();
  const st = getState();
  st.engines.register({ meta: new EngineMeta({ engineId: "taken", displayName: "Taken", backend: "test", supportedRuntimes: ["http"] }), ready: () => false });
  expect((await c.post("/v1/engines/external", { json: { ...KOKORO, id: "taken" } })).status).toBe(409);

  expect((await c.post("/v1/engines/external", { json: KOKORO })).status).toBe(201);
  const before = st.engines.get("kokoro-local");
  const bad = await c.post("/v1/engines/external", { json: { ...KOKORO, provider_type: "no-such-type" } });
  expect(bad.status).toBe(400);
  expect(st.engines.get("kokoro-local")).toBe(before);
  expect((await c.get("/v1/settings")).json().engines.external.map((e) => e.provider_type)).toEqual(["openai-compat"]);
});
