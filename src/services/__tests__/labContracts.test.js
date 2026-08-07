// SPDX-License-Identifier: MIT
// Part 6 contract tests (2026-08-06) — the wire shapes the Lab's pieces agree
// on: the ONE characters format (editor · parser · sample · fill), the
// card-is-the-route map, and the fill blocks that mirror the production
// formatters (server sources named in labTestData.js — these tests pin the
// mirrors so drift breaks loudly).
import { describe, expect, it } from "vitest";

import { ACTION_ROUTE, parseCharacters, passageFrom } from "../attributionLab.js";
import {
  castNamesBlock,
  smartAssignCharactersBlock,
  smartAssignVoicesBlock,
  voiceGenderBlock,
} from "../labTestData.js";

describe("the ONE characters shape", () => {
  it("parses one name per line, aliases behind | or :", () => {
    const rows = parseCharacters("Mara\nRenn | Old Renn, the harbor-master\nSarah: Sal");
    expect(rows.map((r) => r.name)).toEqual(["Mara", "Renn", "Sarah"]);
    expect(rows[1].aliases).toEqual(["Old Renn", "the harbor-master"]);
    expect(rows[2].aliases).toEqual(["Sal"]);
  });

  it("generates internal ids — never typed, never shown", () => {
    const rows = parseCharacters("Mara Vance");
    expect(rows[0].id).toBe("c_mara_vance_0");
  });

  it("drops blank lines and whitespace padding", () => {
    expect(parseCharacters("  \nMara\n\n  Sarah  \n")).toHaveLength(2);
  });

  it("the seeded cellar sample's cast parses to Mara + Sarah", () => {
    // Mirrors seed_presets.py _ATTR_SAMPLE_VARS.characters verbatim.
    const rows = parseCharacters("Mara\nSarah");
    expect(rows.map((r) => r.name)).toEqual(["Mara", "Sarah"]);
  });

  it("round-trips the cast fill (castNamesBlock → parseCharacters)", () => {
    const block = castNamesBlock([{ name: "Mara" }, { name: "Old Harbek" }]);
    expect(parseCharacters(block).map((r) => r.name)).toEqual(["Mara", "Old Harbek"]);
  });
});

describe("the card is the route", () => {
  it("each route card forces exactly its own route", () => {
    expect(ACTION_ROUTE).toEqual({
      "speaker_attribution.guided": "guided",
      "speaker_attribution.direct": "direct",
    });
  });
});

describe("passage variable resolution", () => {
  it("reads whichever template name carries the passage", () => {
    expect(passageFrom({ paragraphs: "a" })).toBe("a");
    expect(passageFrom({ manuscript: "b" })).toBe("b");
    expect(passageFrom({ text: "c" })).toBe("c");
    expect(passageFrom({})).toBe("");
  });
});

describe("fill blocks mirror the production formatters", () => {
  it("smart-assign characters — smart_assign_api._format_characters shape", () => {
    const block = smartAssignCharactersBlock([
      { id: "c_1", name: "Mara", bio: "dry archivist" },
      { id: "c_2", name: "Renn", personality: "gravel-voiced" },
      { id: "c_3", name: "Extra" },
    ]);
    expect(block).toBe(
      '- id="c_1", name="Mara", description="dry archivist"\n' +
        '- id="c_2", name="Renn", description="gravel-voiced"\n' +
        '- id="c_3", name="Extra"',
    );
  });

  it("smart-assign voices — smart_assign_api._format_voices shape", () => {
    const block = smartAssignVoicesBlock([
      { id: "v_1", name: "Slate", gender: "male", language: "en-US" },
      { id: "v_2", name: "Finch" },
    ]);
    expect(block).toBe(
      '- id="v_1", name="Slate", gender="male", language="en-US"\n- id="v_2", name="Finch"',
    );
  });

  it("voice-gender lines — voices_api's '- Name — description' shape", () => {
    const block = voiceGenderBlock([
      { name: "Finch", design_prompt: "bright youthful voice" },
      { id: "af_bella" },
    ]);
    expect(block).toBe("- Finch — bright youthful voice\n- af_bella");
  });
});
