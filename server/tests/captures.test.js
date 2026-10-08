// SPDX-License-Identifier: MIT
// Captures — dictation recordings and their refinement (the port of tests/test_captures.py).
//
// The repetition collapse is refinement's own pure pass; the system composition reads the
// seeded `refine.*` prompt rows, so its test boots the LLM half of create_app headless
// (llm_boot.js).
import * as dispatch from "@delebash/llm-runner/llm/dispatch";
import { LLMNotConfiguredError } from "@delebash/llm-runner/llm/dispatch";
import { afterEach, expect, test, vi } from "vitest";
import * as captures from "../src/api/captures_api.js";
import { cfg as appCfg } from "../src/app_state.js";
import { collapseRepetitiveArtifacts as collapse, composeRefinementSystem, RefinementFlags } from "../src/refinement.js";
import { appClient, closeApps } from "./app_helpers.js";
import { closeModuleDb, tmpPath } from "./helpers.js";
import { llmBoot } from "./llm_boot.js";

afterEach(async () => {
  await closeApps();
  closeModuleDb();
  appCfg.state = null;
});

/** The app, seeded, with the engine round-trip faked — STT correctness is the engine's
 * concern; here the API contract is tested. */
async function capturesClient() {
  const { c } = await appClient(undefined, { seed: true });
  vi.spyOn(captures, "_sttTranscribe").mockResolvedValue("um hello hello world");
  return c;
}

const wav = () => Buffer.from("RIFF0000WAVEfmt ");

test("transcribe_stateless", async () => {
  const c = await capturesClient();
  const r = await c.post("/v1/transcribe", { files: { file: ["a.wav", wav(), "audio/wav"] } });
  expect(r.status).toBe(200);
  expect(r.json().text).toBe("um hello hello world");
});

test("capture_crud_and_refine_degrades", async () => {
  // The behaviour under test is "refinement unavailable → fall back to raw", so the
  // unavailability is FORCED rather than assumed.
  const c = await capturesClient();
  vi.spyOn(dispatch, "chat").mockImplementation(() => {
    throw new LLMNotConfiguredError("no LLM provider registered");
  });
  const r = await c.post("/v1/captures", { files: { file: ["a.wav", wav(), "audio/wav"] }, data: { source: "upload" } });
  expect(r.status, r.text).toBe(201);
  const row = r.json();
  // auto_refine is on but refinement cannot reach a provider — the transcript falls back to raw,
  // never null.
  expect(row.raw_transcript).toBe("um hello hello world");
  expect(row.transcript).toBe("um hello hello world");
  expect(row.refinement_flags.smart_cleanup).toBe(true);

  expect((await c.get("/v1/captures")).json().total).toBe(1);

  const audio = await c.get(row.audio_url);
  expect(audio.status).toBe(200);
  expect(audio.content.subarray(0, 4).toString()).toBe("RIFF");

  expect((await c.post(`/v1/captures/${row.id}/retranscribe`)).status).toBe(200);

  expect((await c.delete(`/v1/captures/${row.id}`)).status).toBe(200);
  expect((await c.get("/v1/captures")).json().total).toBe(0);
});

test("collapse_repetitive_artifacts", () => {
  // 6+ token loop dropped; rhetorical 5x kept.
  expect(collapse("ok URL URL URL URL URL URL done")).toBe("ok done");
  expect(collapse("I said no, no, no, no, no to that")).toContain("no, no, no, no, no");
  // character-level CJK loop
  expect(collapse("end 谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看 fin")).toBe("end fin");
  // emphasized single letters survive (2-char lower bound)
  expect(collapse("wooooooow")).toBe("wooooooow");
});

test("compose_refinement_system_toggles", async () => {
  // F1 Phase 2: the system assembles from the TEMPLATE ROWS (refine.base + enabled section
  // rows); the no-sections identity line lives in the base row itself, so flags-all-off still
  // states it.
  await llmBoot(tmpPath());
  const allOn = composeRefinementSystem(new RefinementFlags());
  expect(allOn.toLowerCase()).toContain("self");
  expect(allOn.toLowerCase()).toContain("technical");
  const noneOn = composeRefinementSystem(new RefinementFlags({ smartCleanup: false, selfCorrection: false, preserveTechnical: false }));
  expect(noneOn.toLowerCase()).toContain("return the transcript unchanged");
  expect(noneOn.toLowerCase()).not.toContain("technical");
});
