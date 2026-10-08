// SPDX-License-Identifier: MIT
// Tests for PATCH /v1/voices/{id} — stored-voice metadata updates (the port of
// tests/test_voices_update.py): VoiceStore.update()'s partial-update semantics, and the HTTP
// endpoint (200 stored, 404 missing, PATCH-skips-null).
import { afterEach, expect, test } from "vitest";
import { getState } from "../src/app_state.js";
import { dtMicros, utcNow } from "../src/models.js";
import { VoiceStore } from "../src/storage/voices.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

function record(id = "voice_test1") {
  const now = utcNow();
  return {
    id,
    engine: "kokoro",
    source: "cloned",
    name: "Sarah",
    language: "en-US",
    gender: null,
    created_at: now,
    updated_at: now,
  };
}

// ── VoiceStore.update() ──────────────────────────────────────────────────────

test("store_update_sets_fields", () => {
  const tmp = tmpPath();
  const store = new VoiceStore(tmp);
  store.create(record());
  const rec = store.update("voice_test1", { gender: "F", name: "Sarah 2" });
  expect(rec).not.toBeNull();
  expect(rec.gender).toBe("F");
  expect(rec.name).toBe("Sarah 2");
  // Persisted — a fresh store re-reads from disk.
  expect(new VoiceStore(tmp).get("voice_test1").gender).toBe("F");
});

test("store_update_skips_none", () => {
  const store = new VoiceStore(tmpPath());
  store.create(record());
  store.update("voice_test1", { gender: "M" });
  const rec = store.update("voice_test1", { gender: null, name: "Renamed" });
  expect(rec.gender).toBe("M"); // untouched by the None
  expect(rec.name).toBe("Renamed");
});

test("store_update_missing_returns_none", () => {
  expect(new VoiceStore(tmpPath()).update("nope", { gender: "F" })).toBeNull();
});

test("store_update_bumps_updated_at", () => {
  const store = new VoiceStore(tmpPath());
  const created = store.create(record());
  const rec = store.update("voice_test1", { gender: "N" });
  expect(dtMicros(rec.updated_at)).toBeGreaterThanOrEqual(dtMicros(created.updated_at));
});

// ── HTTP endpoint ────────────────────────────────────────────────────────────

test("patch_voice_updates_gender", async () => {
  const { c } = await appClient();
  getState().voices.create(record());
  const r = await c.patch("/v1/voices/voice_test1", { json: { gender: "F" } });
  expect(r.status).toBe(200);
  expect(r.json().gender).toBe("F");
  // Round-trips through GET.
  expect((await c.get("/v1/voices/voice_test1")).json().gender).toBe("F");
});

test("patch_voice_partial_leaves_other_fields", async () => {
  const { c } = await appClient();
  getState().voices.create(record());
  const r = await c.patch("/v1/voices/voice_test1", { json: { gender: "M" } });
  expect(r.status).toBe(200);
  const body = r.json();
  expect(body.name).toBe("Sarah");
  expect(body.language).toBe("en-US");
});

test("patch_voice_404_when_missing", async () => {
  const { c } = await appClient();
  const r = await c.patch("/v1/voices/voice_missing", { json: { gender: "F" } });
  expect(r.status).toBe(404);
});
