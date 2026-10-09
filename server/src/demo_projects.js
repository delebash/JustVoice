// SPDX-License-Identifier: MIT
// Seeded demo projects — one per kind (the port of justvoice/demo_projects.py; the Scrivener
// tutorial pattern, CONCEPTS §13.7). A real project the user can poke at without breaking
// their own work: import-shaped data run through the SAME adapters and materializer as real
// files, so the demo exercises the production path.
//
// The audiobook demo is a real book from `samples/` (The Ninth Facet — JustWrite's sample),
// imported by the JustWrite adapter. Game and podcast stay built here.
//
// The import pipeline (imports/, its standard schema) is another slice's port; this module
// loads once `imports/index.js` and `imports/standard_schema.js` exist under these names.

import { readFileSync } from "node:fs";
import path from "node:path";
import { KeyError } from "@delebash/llm-runner/platform/py";
import { runAdapter } from "./imports/index.js";
import {
  StandardCharacter,
  StandardImport,
  StandardLine,
  StandardProject,
  StandardScene,
} from "./imports/standard_schema.js";
import { construct } from "./models.js";

/**
 * The samples SHIPPED with the app, mirroring JustWrite's demo seed: `JUSTVOICE_SAMPLES_SRC`
 * when set, else the server package's own `samples/` (one folder above this file's `src/`) —
 * `server/samples/` in a checkout, `node_modules/justvoice-server/samples/` in the packaged app
 * (the Quasar move, 2026-10-08).
 */
export function _bundledSamplesDir() {
  const env = process.env.JUSTVOICE_SAMPLES_SRC;
  if (env) return path.normalize(env);
  return path.resolve(import.meta.dirname, "..", "samples");
}

// The audiobook demo is JustWrite's own sample book (decided 2026-09-27) — the same
// `samples/<name>/book.json` layout JustWrite ships, imported by the SAME JustWrite adapter a
// user's own export goes through.
export const BOOK_SAMPLE = "the-ninth-facet";

function book() {
  const p = path.join(_bundledSamplesDir(), BOOK_SAMPLE, "book.json");
  return runAdapter("justwrite", readFileSync(p), { filename: path.basename(p) });
}

function game() {
  const lines = [
    ["Q01_HALE_001", "hale", "Halt. Ashfall's closed to outsiders since the burning. State your business."],
    ["Q01_HALE_002", "hale", "Refugees, eh? The well's dry and the granary's worse. But we don't turn folk away."],
    ["Q01_VYRA_001", "vyra", "I saw you in the smoke, traveler. You and the gate that should not open."],
    ["Q02_KEEPER_001", "keeper", "Three seals were placed. Three seals must answer. What do you carry?"],
    ["Q02_BRANN_001", "brann", "That gate ate my whole crew in '04. You want it open, you dig alone."],
  ];
  const scenes = new Map();
  for (const [lid, who, text] of lines) {
    const group = lid.startsWith("Q01") ? "Ashfall Village" : "The Ember Gate";
    if (!scenes.has(group)) {
      scenes.set(
        group,
        construct(StandardScene, { id: group.toLowerCase().replaceAll(" ", "-"), title: group, kind: "cue", lines: [] }),
      );
    }
    scenes.get(group).lines.push(construct(StandardLine, { character_id: who, text, source_ref: lid }));
  }
  return construct(StandardImport, {
    source: "demo",
    project: construct(StandardProject, {
      name: "Demo — Emberfall VO",
      kind: "game_voicelines",
      description: "seeded demo · stable line ids",
      language: "en-US",
    }),
    characters: [
      construct(StandardCharacter, { id: "hale", name: "Guard Captain Hale", voice_hint: "gruff male" }),
      construct(StandardCharacter, { id: "vyra", name: "Vyra the Seer", voice_hint: "low female, deliberate" }),
      construct(StandardCharacter, { id: "keeper", name: "The Gatekeeper", voice_hint: "hollow, doubled" }),
      construct(StandardCharacter, { id: "brann", name: "Brann Ironhand", voice_hint: "weathered male" }),
    ],
    scenes: [...scenes.values()],
  });
}

function podcast() {
  return construct(StandardImport, {
    source: "demo",
    project: construct(StandardProject, {
      name: "Demo — Signal & Noise ep. 42",
      kind: "podcast",
      description: "seeded demo · 3 speakers",
      language: "en-US",
    }),
    characters: [
      construct(StandardCharacter, { id: "sarah", name: "Sarah", voice_hint: "bright host" }),
      construct(StandardCharacter, { id: "jin", name: "Jin", voice_hint: "dry co-host" }),
      construct(StandardCharacter, { id: "mave", name: "Mave", voice_hint: "guest, thoughtful" }),
    ],
    scenes: [
      construct(StandardScene, {
        id: "intro",
        title: "Ep. 42 — The codec episode",
        kind: "segment",
        lines: [
          construct(StandardLine, {
            character_id: "sarah",
            text: "Welcome back to Signal and Noise. I'm Sarah, that's Jin, and today we have Mave from the Open Audio Project.",
          }),
          construct(StandardLine, {
            character_id: "jin",
            text: "Mave, your team just shipped a codec that's half the bitrate of anything else out there. [curious]",
          }),
          construct(StandardLine, {
            character_id: "mave",
            text: "[laughs] Half on a good day. The trick is we stopped trying to preserve the waveform.",
          }),
        ],
      }),
    ],
  });
}

export const DEMOS = {
  audiobook: book,
  game_voicelines: game,
  podcast,
};

/** The demo project of a kind as a StandardImport (KeyError for an unknown kind). The
 * adapter may be async; await the result. */
export function demoStandard(kind) {
  const builder = Object.hasOwn(DEMOS, kind) ? DEMOS[kind] : null;
  if (builder === null) throw new KeyError(kind);
  return builder();
}
