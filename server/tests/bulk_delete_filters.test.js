// SPDX-License-Identifier: MIT
// DELETE /v1/generations — engine / persona-aware voice filters (wiring-audit W1) (the port of
// tests/test_bulk_delete_filters.py).
//
// The voice filter previously matched only the legacy profile_id column, silently missing every
// persona-era row. The rows are written straight into the app's database, as Python's `_seed`
// did through `get_db()`.
import { afterEach, expect, test } from "vitest";
import { Generation, Persona, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

/** Three generations: legacy voice row, persona-bound row, other-engine row → their ids in that
 * order. */
function seed() {
  const h = session.getDb();
  h.insert(Persona, { id: "per-1", name: "Narrator", voice_id: "voice-1" });
  const legacy = { id: uuid(), text: "legacy", engine: "kokoro", status: "completed", profile_id: "voice-1" };
  const personaEra = { id: uuid(), text: "persona-era", engine: "kokoro", status: "completed", persona_id: "per-1" };
  const other = { id: uuid(), text: "other", engine: "tada", status: "completed" };
  h.tx(() => {
    for (const g of [legacy, personaEra, other]) h.insert(Generation, g);
  });
  return [legacy.id, personaEra.id, other.id];
}

const remainingIds = async (c) => new Set((await c.get("/v1/takes/recent")).json().takes.map((t) => t.id));

test("voice_filter_matches_legacy_and_persona_rows", async () => {
  const { c } = await appClient();
  const [, , otherId] = seed();

  const dry = (await c.delete("/v1/generations?voice_id=voice-1")).json();
  expect(dry.dry_run).toBe(true);
  expect(dry.deleted_count).toBe(2);

  const r = (await c.delete("/v1/generations?voice_id=voice-1&confirm=true")).json();
  expect(r.deleted_count).toBe(2);

  expect(await remainingIds(c)).toEqual(new Set([otherId]));
});

test("engine_filter", async () => {
  const { c } = await appClient();
  const [legacyId, personaId] = seed();

  const r = (await c.delete("/v1/generations?engine=tada&confirm=true")).json();
  expect(r.deleted_count).toBe(1);

  expect(await remainingIds(c)).toEqual(new Set([legacyId, personaId]));
});

test("no_filters_still_400s", async () => {
  const { c } = await appClient();
  seed();
  const r = await c.delete("/v1/generations");
  expect(r.status).toBe(400);
});
