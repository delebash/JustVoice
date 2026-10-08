// SPDX-License-Identifier: MIT
// The use-case-generalized Project → Scene → Block schema (the port of
// tests/test_projects.py). The ORM queries become SQL on the captured schema; the
// Python-side defaults (uuid ids, timestamps) come from the column map.
import { expect, test } from "vitest";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { tmpDb } from "./helpers.js";

test("project_types_are_first_class", () => {
  // Audiobook + game_voicelines + podcast + custom all coexist.
  const h = tmpDb();
  const types = ["audiobook", "game_voicelines", "podcast", "custom"];
  h.tx(() => {
    for (const t of types) h.insert("projects", { name: `P-${t}`, project_type: t });
  });
  for (const t of types) expect(h.all("select * from projects where project_type = ?", [t]).length).toBe(1);
});

test("scene_block_ordering", () => {
  // Scenes + blocks maintain position ordering.
  const h = tmpDb();
  const p = "proj-book";
  h.insert("projects", { id: p, name: "Book", project_type: "audiobook" });
  for (let i = 0; i < 3; i++) {
    const sid = `scene-${i}`;
    h.insert("scenes", { id: sid, project_id: p, position: i, title: `Chapter ${i + 1}` });
    for (let j = 0; j < 2; j++) h.insert("blocks", { scene_id: sid, position: j, text: `Paragraph ${j + 1}` });
  }
  const scenes = h.all("select * from scenes where project_id = ? order by position", [p], "scenes");
  expect(scenes.map((s) => s.position)).toEqual([0, 1, 2]);
  for (const s of scenes) {
    const blocks = h.all("select * from blocks where scene_id = ? order by position", [s.id], "blocks");
    expect(blocks.map((b) => b.position)).toEqual([0, 1]);
  }
  // The Python-side defaults filled in: a uuid4 id and a microsecond UTC timestamp.
  const b = h.one("select * from blocks limit 1", [], "blocks");
  expect(b.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(h.value("select created_at from blocks limit 1")).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}$/);
});

test("cast_assignment", () => {
  // A speaker belongs to one book and is played by a persona (the cast).
  const h = tmpDb();
  h.insert("projects", { id: "g", name: "Game", project_type: "game_voicelines" });
  h.insert("personas", { id: "per", name: "Gruff dockhand", note: "low, gravelly" });
  h.insert("speakers", { project_id: "g", name: "Mara", description: "Lead detective", persona_id: "per", role_label: "narrator" });
  const row = h.one("select * from speakers where project_id = ? limit 1", ["g"], "speakers");
  expect(row.role_label).toBe("narrator");
  expect(row.persona_id).toBe("per");
});

test("project_metadata_json_round_trip", () => {
  // Per-type metadata (author/title for audiobook) survives a round-trip.
  const h = tmpDb();
  h.insert("projects", {
    id: "nf",
    name: "The Ninth Facet",
    project_type: "audiobook",
    metadata_json: pyJson({ author: "D. Nash", isbn: "978-..." }),
    mastering_preset: "acx",
  });
  const fetched = h.get("projects", "nf");
  expect(JSON.parse(fetched.metadata_json).author).toBe("D. Nash");
  expect(fetched.mastering_preset).toBe("acx");
});
