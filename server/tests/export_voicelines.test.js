// SPDX-License-Identifier: MIT
// Voiceline zip export — layout, manifest, stable ids, unassigned guard (the port of
// tests/test_export_voicelines.py).
//
// Python imported a CSV sheet through POST /v1/projects/import (csv_lines) and exported through
// POST /v1/projects/{id}/export_voicelines — both the API wave's. Here the sheet's three lines
// are written straight to the database as the csv_lines import materializes them (a chapter
// per `scene`, a speaker per `character`, each line's `id` as its `source_ref`), and
// `exportVoicelines` is called directly; the route's 400 is the ApiError it throws.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as session from "../src/database/session.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import { ApiError } from "../src/errors.js";
import * as exportVoicelines from "../src/export_voicelines.js";
import { ZipReader } from "@delebash/llm-runner/platform/zip";

const wav = (seconds = 0.25, rate = 16000) => writeWavContainer(Buffer.alloc(2 * Math.trunc(rate * seconds)), rate, 1);

const CSV = [
  ["Q01_HALE_001", "Ashfall Village", "Guard Hale", "Halt. State your business."],
  ["Q01_VYRA_001", "Ashfall Village", "Vyra", "I saw you in the smoke."],
  ["Q02_KEEPER_001", "The Ember Gate", "The Gatekeeper", "Three seals were placed."],
];

let st;
beforeEach(() => {
  st = useState();
});
afterEach(() => endState());

function seed() {
  const h = session.getDb();
  const pid = uuid();
  h.insert(Project, { id: pid, name: "emberfall", project_type: "game_voicelines" });
  const scenes = new Map();
  const speakers = new Map();
  const positions = new Map();
  for (const [id, scene, character, text] of CSV) {
    if (!scenes.has(scene)) {
      const sid = uuid();
      h.insert(Scene, { id: sid, project_id: pid, position: scenes.size, title: scene });
      scenes.set(scene, sid);
    }
    if (!speakers.has(character)) {
      const spid = uuid();
      h.insert(Speaker, { id: spid, project_id: pid, name: character });
      speakers.set(character, spid);
    }
    const sid = scenes.get(scene);
    const pos = positions.get(sid) ?? 0;
    positions.set(sid, pos + 1);
    h.insert(Block, { scene_id: sid, position: pos, text, speaker_id: speakers.get(character), metadata_json: JSON.stringify({ source_ref: id }) });
  }
  return pid;
}

test("zip_layout_and_manifest", async () => {
  const pid = seed();
  vi.spyOn(exportVoicelines, "_renderBlockProduction").mockImplementation(async () => wav());
  const zf = ZipReader.fromBuffer(await exportVoicelines.exportVoicelines(st, pid));
  const names = zf.names().sort();
  expect(names).toContain("ashfall-village/Q01_HALE_001.wav");
  expect(names).toContain("ashfall-village/Q01_VYRA_001.wav");
  expect(names).toContain("the-ember-gate/Q02_KEEPER_001.wav");
  const manifest = JSON.parse(zf.read("manifest.json").toString("utf8"));
  expect(manifest.map((m) => m.line_id)).toEqual(["Q01_HALE_001", "Q01_VYRA_001", "Q02_KEEPER_001"]);
  const entry = manifest[0];
  expect(entry.speaker).toBe("Guard Hale"); // the line's speaker (2026-09-29: was "character")
  expect(entry.file).toBe("ashfall-village/Q01_HALE_001.wav");
  expect(entry.duration_s).toBe(0.25);
  expect(entry.text_hash.length).toBe(16);
});

test("unassigned_voice_fails_with_actionable_error", async () => {
  const pid = seed();
  // No persona plays the imported speakers → production renderer must refuse with guidance
  // rather than emit silent/garbage audio.
  const err = await exportVoicelines.exportVoicelines(st, pid).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.statusCode).toBe(400);
  expect(err.detail).toContain("give every speaker a persona with a voice");
});
