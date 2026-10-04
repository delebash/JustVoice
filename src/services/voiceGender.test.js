// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";

// The preset overrides live in the renderer prefs; an in-memory map stands in.
const prefs = {};
vi.mock("./prefs.js", () => ({
  readPref: (key, fallback) => (key in prefs ? prefs[key] : fallback),
  writePref: (key, value) => { prefs[key] = value; },
}));

const { voiceGender, voiceGenderWord, savePresetGenderOverride } = await import("./voiceGender.js");

describe("voiceGender — one answer on every screen", () => {
  it("takes your override on a stored voice first", () => {
    expect(voiceGender({ name: "Sarah", gender: "F", gender_user_override: "M" })).toBe("M");
  });

  it("takes a preset's override from the prefs, and forgets it when cleared", () => {
    const sohee = { id: "Sohee", name: "Sohee", source: "preset", engine: "qwen3", gender: "female" };
    expect(voiceGender(sohee)).toBe("F");
    savePresetGenderOverride("Sohee", "N");
    expect(voiceGender(sohee)).toBe("N");
    savePresetGenderOverride("Sohee", "");
    expect(voiceGender(sohee)).toBe("F");
  });

  it("reads a Kokoro id's letter: af_ is female, bm_ is male", () => {
    expect(voiceGender({ id: "af_heart", name: "Heart", engine: "kokoro" })).toBe("F");
    expect(voiceGender({ id: "bm_george", name: "George", engine: "kokoro" })).toBe("M");
  });

  it("falls back to a first name, and says ? when it can't tell", () => {
    expect(voiceGender({ name: "michael_take2.wav" })).toBe("M");
    expect(voiceGender({ name: "Alex" })).toBe("?");
    expect(voiceGender(null)).toBe("?");
  });

  it("gives a word for a dropdown label", () => {
    expect(voiceGenderWord({ name: "Emma" })).toBe("Female");
    expect(voiceGenderWord({ name: "Zed" })).toBe("?");
  });
});
