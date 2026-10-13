// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { castModelChoices, smartAssignSpeakers, splitByName, voicesForBook } from "./newPersonas.js";

describe("New persona for the N with none (2026-10-05)", () => {
  it("casts a speaker with the library persona of exactly their name; the rest need one", () => {
    const { byName, rest } = splitByName(
      [{ id: "s1", name: "Narrator" }, { id: "s2", name: "Nettle" }, { id: "s3", name: "nettle" }],
      [{ id: "p1", name: "Narrator" }, { id: "p2", name: "June" }],
    );
    expect(byName.map((x) => [x.speaker.id, x.persona.id])).toEqual([["s1", "p1"]]);
    expect(rest.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("offers the voices that speak the book's language, region aside — all when it isn't set", () => {
    const voices = [
      { id: "a", language: "en-us" }, { id: "b", language: "ko" },
      { id: "c", language: "zh", speaks: ["zh", "en", "ko"] }, { id: "d", language: "en-gb" },
    ];
    expect(voicesForBook(voices, "en").map((v) => v.id)).toEqual(["a", "c", "d"]);
    expect(voicesForBook(voices, "ko").map((v) => v.id)).toEqual(["b", "c"]);
    expect(voicesForBook(voices, "").length).toBe(4);
  });
});

describe("What Smart-assign and ＋ New persona choose from (2026-10-13)", () => {
  it("lists each model, not each engine, most voices first", () => {
    const voices = [
      { engine: "kokoro", model: "kokoro", model_name: "Kokoro" },
      { engine: "kokoro", model: "kokoro", model_name: "Kokoro" },
      { engine: "kokoro", model: "kokoro", model_name: "Kokoro" },
      { engine: "qwen3", model: "qwen3-cv", model_name: "Qwen3-TTS CustomVoice" },
      { engine: "qwen3", model: "qwen3-cv", model_name: "Qwen3-TTS CustomVoice" },
      { engine: "qwen3", model: "qwen3-base", model_name: "Qwen3-TTS Base" },
    ];
    expect(castModelChoices(voices)).toEqual([
      { value: "kokoro", label: "Kokoro (3)" },
      { value: "qwen3-cv", label: "Qwen3-TTS CustomVoice (2)" },
      { value: "qwen3-base", label: "Qwen3-TTS Base (1)" },
    ]);
  });

  it("names an online provider's voices by its engine, whose model name is the raw id", () => {
    const voices = [
      { engine: "openai-1", model: "openai-1", model_name: "openai-1" },
      { engine: "openai-1", model: "openai-1", model_name: "openai-1" },
      { engine: "kokoro", model: "kokoro", model_name: "Kokoro" },
    ];
    expect(castModelChoices(voices, { "openai-1": "My OpenAI", kokoro: "Kokoro" })).toEqual([
      { value: "openai-1", label: "My OpenAI (2)" },
      { value: "kokoro", label: "Kokoro (1)" },
    ]);
    expect(castModelChoices(voices)[0].label).toBe("openai-1 (2)");
  });

  it("Smart-assign reads a narrator with no persona, and never one who has a persona", () => {
    const june = { id: "s1", name: "June", persona_id: "p1" };
    const nettle = { id: "s2", name: "Nettle", persona_id: null };
    const bare = { id: "n1", name: "Narrator", role_label: "narrator", persona_id: null };
    const cast = { ...bare, persona_id: "p9" };
    expect(smartAssignSpeakers([bare, june, nettle]).map((s) => s.id)).toEqual(["n1", "s1", "s2"]);
    expect(smartAssignSpeakers([cast, june, nettle]).map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});
