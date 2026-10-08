// SPDX-License-Identifier: MIT
// Game re-import — update-in-place by stable line id + derived staleness (the port of
// tests/test_reimport_update.py).
//
// The tests run on the real app (create_app). The speech model is faked as Python faked it
// (`render_core.renderLine`): a short silence that records the real inputs key.
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import * as renderCore from "../src/render_core.js";
import { lineInputsKey, RenderedLine } from "../src/render_core.js";

afterEach(closeApps);

const CSV_V1 = `id,scene,character,text
Q01_A,Ashfall,Hale,"Halt. State your business."
Q01_B,Ashfall,Hale,"The well's dry."
Q02_A,Gate,Keeper,"Three seals were placed."
`;

// v2: Q01_A changed, Q01_B unchanged, Q02_A removed, Q02_B added
const CSV_V2 = `id,scene,character,text
Q01_A,Ashfall,Hale,"HALT. State your business, traveler."
Q01_B,Ashfall,Hale,"The well's dry."
Q02_B,Gate,Keeper,"Three seals must answer."
`;

async function importCsv(c, csv, projectId = null) {
  const data = { source: "csv_lines", dry_run: "false" };
  if (projectId) data.project_id = projectId;
  const r = await c.post("/v1/projects/import", { data, files: { file: ["emberfall.csv", Buffer.from(csv, "utf8"), "text/csv"] } });
  expect(r.status, r.text).toBe(200);
  return r.json();
}

/** The speech model, faked: renderLine returns a short silence that records the real inputs key
 * (render_core.lineInputsKey), so a take made through the production door reads "rendered" until
 * its line changes — Render's rule since Slice 4 (2026-10-04). */
function fakeSpeech() {
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (st, kw) => {
    const key = await lineInputsKey(st, kw.voice, kw.text, {
      language: kw.language,
      delivery: kw.delivery,
      seed: kw.seed,
      lexicons: kw.lexicons,
      effects: kw.effects,
    });
    return new RenderedLine({ pcm: Buffer.alloc(2 * 160), sampleRate: 16000, channels: 1, effectiveDelivery: {}, inputsKey: key || "", seed: kw.seed ?? null });
  });
}

/** Each speaker played by a persona with a voice — a line can render only then. */
async function castEveryone(c, pid) {
  const persona = (await c.post("/v1/personas", { json: { name: "Gruff guard", voice_id: "af_heart" } })).json().id;
  for (const sp of (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers) {
    await c.patch(`/v1/speakers/${sp.id}`, { json: { persona_id: persona } });
  }
}

/** Render those lines through the one-line door (a take each). */
async function markRendered(c, pid, lineIds) {
  for (const row of (await c.get(`/v1/projects/${pid}/lines`)).json().lines) {
    if (lineIds.has(row.line_id)) {
      const r = await c.post(`/v1/blocks/${row.block_id}/render`);
      expect(r.status, r.text).toBe(200);
    }
  }
}

test("reimport_updates_in_place_and_derives_staleness", async () => {
  const { c } = await appClient();
  fakeSpeech();
  const pid = (await importCsv(c, CSV_V1)).project_id;
  await castEveryone(c, pid);
  await markRendered(c, pid, new Set(["Q01_A", "Q01_B", "Q02_A"]));

  const before = (await c.get(`/v1/projects/${pid}/lines`)).json();
  expect(before.counts).toEqual({ none: 0, rendered: 3, stale: 0 });

  const r = await importCsv(c, CSV_V2, pid);
  expect(r.project_id).toBe(pid);
  expect(r.warnings.some((w) => w.includes("updated in place"))).toBe(true);

  const after = (await c.get(`/v1/projects/${pid}/lines`)).json();
  const byId = Object.fromEntries(after.lines.map((row) => [row.line_id, row]));
  expect(byId.Q01_A.take_status).toBe("stale"); // text changed
  expect(byId.Q01_A.text.startsWith("HALT.")).toBe(true);
  expect(byId.Q01_B.take_status).toBe("rendered"); // untouched
  expect(byId.Q02_B.take_status).toBe("none"); // new line
  expect("Q02_A" in byId).toBe(false); // removed
  expect(after.counts).toEqual({ none: 1, rendered: 1, stale: 1 });
  // No duplicate project created.
  const projects = (await c.get("/v1/projects")).json().projects;
  expect(projects.filter((p) => p.name === "emberfall").length).toBe(1);
});

test("update_requires_stable_ids", async () => {
  const { c } = await appClient();
  const pid = (await importCsv(c, CSV_V1)).project_id;
  const noIds = 'scene,character,text\nAshfall,Hale,"Hello."\n';
  const r = await c.post("/v1/projects/import", {
    data: { source: "csv_lines", dry_run: "false", project_id: pid },
    files: { file: ["x.csv", Buffer.from(noIds, "utf8"), "text/csv"] },
  });
  expect(r.status).toBe(400);
  expect(r.text).toContain("stable line id");
});

test("block_render_clears_staleness", async () => {
  const { c } = await appClient();
  fakeSpeech();
  const pid = (await importCsv(c, CSV_V1)).project_id;
  // Hale played by a persona with a voice, so the production renderer accepts the block (line →
  // speaker → persona, 2026-09-29).
  await castEveryone(c, pid);
  await markRendered(c, pid, new Set(["Q01_A"]));
  // change the text via re-import v2 → Q01_A goes stale
  await importCsv(c, CSV_V2, pid);
  let lines = (await c.get(`/v1/projects/${pid}/lines`)).json().lines;
  const stale = lines.find((row) => row.line_id === "Q01_A");
  expect(stale.take_status).toBe("stale");
  expect(stale.state).toBe("stale");

  const r = await c.post(`/v1/blocks/${stale.block_id}/render`);
  expect(r.status, r.text).toBe(200);
  lines = (await c.get(`/v1/projects/${pid}/lines`)).json().lines;
  expect(lines.find((x) => x.line_id === "Q01_A").take_status).toBe("rendered");
});
