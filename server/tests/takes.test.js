// SPDX-License-Identifier: MIT
// Tests for the takes table — per-block take versioning invariants (the port of
// tests/test_takes.py).
//
// Covers both direct-DB invariants and HTTP API behaviour. Python built a minimal FastAPI app
// from the takes router only, over the conftest_db SQLite; here a bare app holds just the takes
// router (render_helpers.js `viaRoutes`) over the test's own module database and app state
// (`useState()` — the generation audio route resolves stored paths against its data folder).
// Python's test classes are `describe` blocks with the same names.
//
// Python's TestGenerationAudio 404-on-disk and 200 tests pass only after an earlier test in the
// run has set the app state: run alone, `media_file` finds none and both answer 500 (measured
// 2026-10-08, pytest on this file alone). Here the state is the test's own, so they pass.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { router as takesRouter } from "../src/api/takes_api.js";
import { Block, Generation, Persona, Project, Scene, Take, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { tmpPath } from "./helpers.js";
import { viaRoutes } from "./render_helpers.js";

beforeEach(() => {
  useState();
});
afterEach(() => endState());

const h = () => session.getDb();

// ── helpers ──────────────────────────────────────────────────────────────────

/** One Persona + Project + Scene + Block → `[voice, block]`. (A persona stands where the
 * dropped VoiceProfile was; Generation.profile_id keeps its id as before.) */
function seed() {
  const v = { id: uuid(), name: "V" };
  h().insert(Persona, v);
  const p = uuid();
  h().insert(Project, { id: p, name: "Book", project_type: "audiobook" });
  const s = uuid();
  h().insert(Scene, { id: s, project_id: p, position: 0 });
  const b = { id: uuid(), scene_id: s, position: 0, text: "Hello." };
  h().insert(Block, b);
  return [v, b];
}

function gen(v, b, extra = {}) {
  const g = { id: uuid(), text: b.text, engine: "kokoro", profile_id: v.id, block_id: b.id, ...extra };
  h().insert(Generation, g);
  return g;
}

function take(fields) {
  const t = { id: uuid(), ...fields };
  h().insert(Take, t);
  return t;
}

/** A minimal valid WAV file at `p` (0.1 s of silence, 16-bit mono 44.1 kHz). */
function makeWav(p) {
  const pcm = Buffer.alloc(2 * 4410);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVE", 8, "latin1");
  head.write("fmt ", 12, "latin1");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(44100, 24);
  head.writeUInt32LE(88200, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "latin1");
  head.writeUInt32LE(pcm.length, 40);
  writeFileSync(p, Buffer.concat([head, pcm]));
}

/** The test client over the takes router (Python's `api_client`). */
async function api(fn) {
  return viaRoutes([takesRouter], async (app) => {
    const send = async (method, url, json) => {
      const r = await app.inject({
        method,
        url,
        ...(json !== undefined ? { payload: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}),
      });
      return { status: r.statusCode, headers: r.headers, json: () => JSON.parse(r.body) };
    };
    return fn({
      get: (url) => send("GET", url),
      post: (url, json) => send("POST", url, json),
      patch: (url, json) => send("PATCH", url, json),
      delete: (url) => send("DELETE", url),
    });
  });
}

const defaults = (blockId) => h().all(`select * from ${Take} where block_id = ? and is_default = 1`, [blockId], Take);

// ── direct-DB invariant tests ────────────────────────────────────────────────

test("default_take_is_at_most_one_per_block_in_application_layer", () => {
  // Application code (set_default) clears prior defaults before marking the new one.
  const [v, b] = seed();
  const g1 = gen(v, b);
  const g2 = gen(v, b);
  take({ block_id: b.id, generation_id: g1.id, is_default: true, label: "Take 1" });
  const t2 = take({ block_id: b.id, generation_id: g2.id, is_default: false, label: "Take 2" });
  // Simulate the set-default flow.
  h().tx(() => {
    h().update(Take, { is_default: false }, "block_id = ? and is_default = 1", [b.id]);
    h().update(Take, { is_default: true }, { id: t2.id });
  });
  const ds = defaults(b.id);
  expect(ds.length).toBe(1);
  expect(ds[0].id).toBe(t2.id);
});

test("take_lineage", () => {
  // source_take_id chains so retakes-of-retakes are traceable.
  const [v, b] = seed();
  const tOrig = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "Original" });
  const tRetake = take({ block_id: b.id, generation_id: gen(v, b).id, source_take_id: tOrig.id, label: "Retake" });
  expect(h().get(Take, tRetake.id).source_take_id).toBe(tOrig.id);
});

// ── HTTP API tests ────────────────────────────────────────────────────────────

describe("TestListTakesForBlock", () => {
  test("returns_takes_newest_first", async () => {
    const [v, b] = seed();
    const g1 = gen(v, b);
    const g2 = gen(v, b);
    // t1 created before t2 (the clock never repeats a microsecond).
    const t1 = take({ block_id: b.id, generation_id: g1.id, is_default: false, label: "First" });
    const t2 = take({ block_id: b.id, generation_id: g2.id, is_default: true, label: "Second" });
    await api(async (c) => {
      const resp = await c.get(`/v1/takes/by_block/${b.id}`);
      expect(resp.status).toBe(200);
      const ids = resp.json().takes.map((t) => t.id);
      expect(ids[0]).toBe(t2.id);
      expect(ids[1]).toBe(t1.id);
    });
  });

  test("default_take_id_matches_is_default_row", async () => {
    const [v, b] = seed();
    take({ block_id: b.id, generation_id: gen(v, b).id, is_default: false, label: "A" });
    const t2 = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "B" });
    await api(async (c) => {
      const resp = await c.get(`/v1/takes/by_block/${b.id}`);
      expect(resp.status).toBe(200);
      expect(resp.json().default_take_id).toBe(t2.id);
    });
  });

  test("empty_block_returns_empty_list", async () => {
    const [, b] = seed();
    await api(async (c) => {
      const resp = await c.get(`/v1/takes/by_block/${b.id}`);
      expect(resp.status).toBe(200);
      expect(resp.json().takes).toEqual([]);
      expect(resp.json().default_take_id).toBeNull();
    });
  });

  test("source_take_id_preserved_in_list", async () => {
    const [v, b] = seed();
    const t1 = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "Orig" });
    const t2 = take({ block_id: b.id, generation_id: gen(v, b).id, source_take_id: t1.id, label: "Retake" });
    await api(async (c) => {
      const resp = await c.get(`/v1/takes/by_block/${b.id}`);
      expect(resp.status).toBe(200);
      const byId = Object.fromEntries(resp.json().takes.map((t) => [t.id, t]));
      expect(byId[t2.id].source_take_id).toBe(t1.id);
      expect(byId[t1.id].source_take_id).toBeNull();
    });
  });
});

describe("TestSetDefaultTake", () => {
  test("marks_take_as_default", async () => {
    const [v, b] = seed();
    take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "Old default" });
    const t2 = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: false, label: "New default" });
    await api(async (c) => {
      const resp = await c.post(`/v1/takes/${t2.id}/set_default`);
      expect(resp.status).toBe(200);
      expect(resp.json().id).toBe(t2.id);
      expect((await c.get(`/v1/takes/by_block/${b.id}`)).json().default_take_id).toBe(t2.id);
    });
  });

  test("clears_old_default_when_promoting", async () => {
    const [v, b] = seed();
    take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "T1" });
    take({ block_id: b.id, generation_id: gen(v, b).id, is_default: false, label: "T2" });
    const t3 = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: false, label: "T3" });
    await api(async (c) => {
      await c.post(`/v1/takes/${t3.id}/set_default`);
      const data = (await c.get(`/v1/takes/by_block/${b.id}`)).json();
      expect(data.default_take_id).toBe(t3.id);
      // Exactly one default in the full list
      expect(data.takes.filter((t) => t.id === data.default_take_id).length).toBe(1);
    });
  });

  test("set_default_on_unknown_take_returns_404", async () => {
    await api(async (c) => {
      expect((await c.post("/v1/takes/nonexistent-id/set_default")).status).toBe(404);
    });
  });

  test("set_default_same_take_is_idempotent", async () => {
    const [v, b] = seed();
    const t1 = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "Only take" });
    await api(async (c) => {
      expect((await c.post(`/v1/takes/${t1.id}/set_default`)).status).toBe(200);
      expect((await c.get(`/v1/takes/by_block/${b.id}`)).json().default_take_id).toBe(t1.id);
    });
  });
});

describe("TestCreateTakeLineage", () => {
  // Takes have no POST /v1/takes (a take is made by a render), so lineage is pinned at the DB
  // layer, as test_take_lineage above.
  test("retake_version_carries_lineage_pointer", () => {
    const [v, b] = seed();
    const tOrig = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true });
    const tRetake = take({ block_id: b.id, generation_id: gen(v, b).id, source_take_id: tOrig.id });
    expect(h().get(Take, tOrig.id).source_take_id).toBeNull();
    expect(h().get(Take, tRetake.id).source_take_id).toBe(tOrig.id);
  });

  test("three_generation_lineage_chain", () => {
    const [v, b] = seed();
    const gens = [gen(v, b), gen(v, b), gen(v, b)];
    const t0 = take({ block_id: b.id, generation_id: gens[0].id, is_default: true });
    const t1 = take({ block_id: b.id, generation_id: gens[1].id, source_take_id: t0.id });
    const t2 = take({ block_id: b.id, generation_id: gens[2].id, source_take_id: t1.id });
    expect(h().get(Take, t2.id).source_take_id).toBe(t1.id);
    expect(h().get(Take, t1.id).source_take_id).toBe(t0.id);
    expect(h().get(Take, t0.id).source_take_id).toBeNull();
  });
});

describe("TestDeleteTake", () => {
  test("delete_non_default_take_returns_200", async () => {
    const [v, b] = seed();
    take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "Keep" });
    const other = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: false, label: "Delete me" });
    await api(async (c) => {
      const resp = await c.delete(`/v1/takes/${other.id}`);
      expect(resp.status).toBe(200);
      expect(resp.json().deleted).toBe(true);
      const ids = (await c.get(`/v1/takes/by_block/${b.id}`)).json().takes.map((t) => t.id);
      expect(ids).not.toContain(other.id);
    });
  });

  test("delete_default_take_puts_the_newest_left_in_use", async () => {
    // The take in use can be deleted (2026-10-07): the newest take left goes in use.
    const [v, b] = seed();
    const [gOld, gMid, gNew] = [gen(v, b), gen(v, b), gen(v, b)];
    take({ block_id: b.id, generation_id: gOld.id, created_at: "2026-10-01T00:00:00" });
    const tMid = take({ block_id: b.id, generation_id: gMid.id, created_at: "2026-10-02T00:00:00" });
    const tInUse = take({ block_id: b.id, generation_id: gNew.id, is_default: true, created_at: "2026-10-03T00:00:00" });
    await api(async (c) => {
      const resp = await c.delete(`/v1/takes/${tInUse.id}`);
      expect(resp.status).toBe(200);
      expect(resp.json()).toEqual({ deleted: true, default_take_id: tMid.id });
      const data = (await c.get(`/v1/takes/by_block/${b.id}`)).json();
      expect(data.default_take_id).toBe(tMid.id);
      expect(data.takes.filter((t) => t.is_default).map((t) => t.id)).toEqual([tMid.id]);
      expect(data.takes.length).toBe(2);
    });
  });

  test("delete_the_only_take_leaves_the_line_without_one", async () => {
    const [v, b] = seed();
    const t = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "Default" });
    await api(async (c) => {
      const resp = await c.delete(`/v1/takes/${t.id}`);
      expect(resp.status).toBe(200);
      expect(resp.json()).toEqual({ deleted: true, default_take_id: null });
      expect((await c.get(`/v1/takes/by_block/${b.id}`)).json()).toEqual({ takes: [], default_take_id: null });
    });
  });

  test("delete_unknown_take_returns_404", async () => {
    await api(async (c) => {
      expect((await c.delete("/v1/takes/does-not-exist")).status).toBe(404);
    });
  });

  test("delete_non_default_does_not_affect_default", async () => {
    const [v, b] = seed();
    const tDefault = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "D" });
    const tOther = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: false, label: "O" });
    await api(async (c) => {
      await c.delete(`/v1/takes/${tOther.id}`);
      const data = (await c.get(`/v1/takes/by_block/${b.id}`)).json();
      expect(data.default_take_id).toBe(tDefault.id);
      expect(data.takes.length).toBe(1);
    });
  });
});

describe("TestGenerationAudio", () => {
  test("returns_404_for_unknown_generation", async () => {
    await api(async (c) => {
      expect((await c.get("/v1/generations/does-not-exist/audio")).status).toBe(404);
    });
  });

  test("returns_400_when_no_audio_path", async () => {
    // Generation exists but has no audio_path → 400 (not completed).
    const [v, b] = seed();
    const g = gen(v, b, { text: "Hello", audio_path: null });
    await api(async (c) => {
      expect((await c.get(`/v1/generations/${g.id}/audio`)).status).toBe(400);
    });
  });

  test("returns_404_when_audio_path_missing_from_disk", async () => {
    const [v, b] = seed();
    const g = gen(v, b, { text: "Hello", audio_path: path.join(tmpPath(), "ghost.wav") });
    await api(async (c) => {
      expect((await c.get(`/v1/generations/${g.id}/audio`)).status).toBe(404);
    });
  });

  test("returns_200_with_wav_content_type_when_file_exists", async () => {
    const dir = tmpPath();
    const wavPath = path.join(dir, "test.wav");
    makeWav(wavPath);
    const [v, b] = seed();
    const g = gen(v, b, { text: "Hello", audio_path: wavPath });
    await api(async (c) => {
      const resp = await c.get(`/v1/generations/${g.id}/audio`);
      expect(resp.status).toBe(200);
      expect(resp.headers["content-type"]).toContain("audio/wav");
    });
  });
});

describe("TestUpdateTakeLabel", () => {
  test("label_can_be_updated", async () => {
    const [v, b] = seed();
    const t = take({ block_id: b.id, generation_id: gen(v, b).id, is_default: true, label: "Old label" });
    await api(async (c) => {
      const resp = await c.patch(`/v1/takes/${t.id}`, { label: "New label" });
      expect(resp.status).toBe(200);
      expect(resp.json().label).toBe("New label");
    });
  });

  test("patch_unknown_take_returns_404", async () => {
    await api(async (c) => {
      expect((await c.patch("/v1/takes/no-such-take", { label: "x" })).status).toBe(404);
    });
  });
});
