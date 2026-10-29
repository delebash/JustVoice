// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { groupOf, modelShown } from "./speechTab.js";

// A kit model row (GET /v1/ai/runtimes/audiocpp/models) and our facts about it (the engines store's factsOf).
const kokoro = { id: "kokoro", name: "Kokoro", licence: { commercial: "Yes" }, tested: { note: "listened" }, status: "installed", deprecated: "" };
const pocket = { id: "pocket", name: "Pocket TTS", licence: { commercial: "Conditional" }, tested: null, status: "installed", deprecated: "" };
const facts = {
  "kokoro-v1": { engine: kokoro, variant: { id: "kokoro-v1", voice_cloning: false, preset_voices: 54, directed_by: "sliders" } },
  "pocket-en": { engine: pocket, variant: { id: "pocket-en", voice_cloning: true, preset_voices: 20, directed_by: "sliders" } },
  "qwen3-cv": { engine: { ...kokoro, id: "qwen3", name: "Qwen3-TTS", tested: null }, variant: { id: "qwen3-cv", voice_cloning: false, preset_voices: 9, directed_by: "words" } },
};
const row = (id, fit = "ok") => ({ id, name: id, fit });

describe("the Speech tab's groups (round E, G6)", () => {
  it("groups a model under its engine, by the engine's name", () => {
    expect(groupOf(row("pocket-en"), facts["pocket-en"])).toEqual({ key: "pocket", label: "Pocket TTS" });
  });
  it("leaves a model no engine of ours lists ungrouped", () => {
    expect(groupOf(row("nobody"), null)).toBeNull();
  });
});

describe("the Speech tab's filters (round E, G6 — the engine list's, 2026-10-11)", () => {
  const shown = (filters) => Object.keys(facts).filter((id) => modelShown(row(id, id === "qwen3-cv" ? "no" : "ok"), filters, facts[id]));

  it("shows every model with no filter on", () => {
    expect(shown({})).toEqual(["kokoro-v1", "pocket-en", "qwen3-cv"]);
  });
  it("Cloning and Built-in voices ask the model", () => {
    expect(shown({ cloning: true })).toEqual(["pocket-en"]);
    expect(shown({ presets: true })).toEqual(["kokoro-v1", "pocket-en", "qwen3-cv"]);
  });
  it("Commercial use and Tested by JustVoice ask the engine", () => {
    expect(shown({ commercial: "Conditional" })).toEqual(["pocket-en"]);
    expect(shown({ commercial: "all" })).toEqual(["kokoro-v1", "pocket-en", "qwen3-cv"]);
    expect(shown({ tested: true })).toEqual(["kokoro-v1"]);
  });
  it("Takes direction is written direction or tags", () => {
    expect(shown({ directed: true })).toEqual(["qwen3-cv"]);
  });
  it("Fits this card is the kit's fit word", () => {
    expect(shown({ fits: true })).toEqual(["kokoro-v1", "pocket-en"]);
  });
  it("hides an engine marked for removal while the runtime isn't installed", () => {
    const going = { engine: { ...pocket, deprecated: "replaced by Pocket 2", status: "not_installed" }, variant: facts["pocket-en"].variant };
    expect(modelShown(row("pocket-en"), {}, going)).toBe(false);
    expect(modelShown(row("pocket-en"), {}, { ...going, engine: { ...going.engine, status: "installed" } })).toBe(true);
  });
  it("a model whose facts haven't come yet passes until a filter asks them", () => {
    expect(modelShown(row("x"), {}, null)).toBe(true);
    expect(modelShown(row("x"), { cloning: true }, null)).toBe(false);
  });
});
