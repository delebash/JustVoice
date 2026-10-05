// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";

vi.mock("./prefs.js", () => ({ readPref: (_k, fallback) => fallback, writePref: () => {} }));

const { bookLanguageOptions, directionCell, sameLanguage, tagCount, voiceKindWord, voiceLabel } =
  await import("./personaFacts.js");

describe("personaFacts — one vocabulary for voices and personas", () => {
  it("names a voice the same way in every dropdown", () => {
    const sohee = { name: "Sohee", gender: "female", language: "ko", model_name: "Qwen3-TTS CustomVoice", engine: "qwen3" };
    expect(voiceLabel(sohee)).toBe("Sohee · Female · Korean · Qwen3-TTS CustomVoice");
    // An unknown gender is left out rather than shown as "?".
    expect(voiceLabel({ name: "Zed", language: "en", engine: "kokoro" })).toBe("Zed · English · kokoro");
  });

  it("says how a persona can be directed, with the model's tag count", () => {
    expect(directionCell("words").label).toBe("✓ written direction");
    expect(directionCell("tags", 19).label).toBe("✓ 19 tags");
    expect(directionCell("tags").label).toBe("✓ tags");
    expect(directionCell("sliders").label).toBe("sliders only");
    expect(tagCount({ inline_tags: [{ tags: ["a", "b"] }, { tags: ["c"] }] })).toBe(3);
  });

  it("calls a voice by how it was made", () => {
    expect(voiceKindWord({ source: "preset" })).toBe("built-in");
    expect(voiceKindWord({ source: "imported" })).toBe("cloned");
    expect(voiceKindWord({ source: "blended" })).toBe("blended");
  });

  it("matches a language whatever its region", () => {
    expect(sameLanguage("en-GB", "en")).toBe(true);
    expect(sameLanguage("ko", "en-US")).toBe(false);
    expect(sameLanguage("", "en")).toBe(false);
  });

  it("offers the book every language its voices' models speak, by plain name", () => {
    const voices = [{ speaks: ["en-US"] }, { speaks: ["ko", "en", "ja"] }, { language: "fr" }];
    const opts = bookLanguageOptions(voices, "en-US");
    expect(opts[0]).toEqual({ value: "", label: "Not set" });
    expect(opts.map((o) => o.value)).toEqual(expect.arrayContaining(["en", "ko", "ja", "fr", "en-US"]));
    expect(opts.find((o) => o.value === "ja").label).toBe("Japanese");
  });
});
