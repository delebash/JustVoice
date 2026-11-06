// SPDX-License-Identifier: MIT
// GET /v1/voices/{id}/bundle.zip answers for a voice named outside Latin-1 — the file name goes in the
// header RFC 6266/5987-encoded (the kit's `attachment()`, as every other download here). A Python bug
// copied into the port on purpose made it a 500 (UnicodeEncodeError; TASKS "The family moves to
// Electron…"; fixed 2026-11-05 as decided 2026-10-08).
import { afterEach, expect, test } from "vitest";
import * as appState from "../src/app_state.js";
import { construct, VoiceRecord } from "../src/models.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

test("a_voice_named_in_japanese_exports", async () => {
  const { c } = await appClient();
  const now = new Date().toISOString();
  const voice = construct(VoiceRecord, {
    id: "voice_jp", engine: "chatterbox", source: "cloned", name: "東京", language: "ja", transcript: "", created_at: now, updated_at: now,
  });
  appState.getState().voices = { get: (id) => (id === voice.id ? voice : null), refWavPath: () => "nowhere.wav" };
  const r = await c.get("/v1/voices/voice_jp/bundle.zip");
  expect(r.status, r.text).toBe(200);
  expect(r.headers["content-disposition"]).toContain(`filename*=UTF-8''${encodeURIComponent("東京.jvvoice.zip")}`);
});
