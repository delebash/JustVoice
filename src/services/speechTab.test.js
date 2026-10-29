// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { SORTS } from "./engineFacts.js";
import { groupOf, groupOrder, modelOrder, modelShown } from "./speechTab.js";

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

describe("the Speech tab's sort (round E — the engine list's, 2026-10-11)", () => {
  // kit rows (bytes, the kit's) and our facts (need_gb, the engine's commercial use)
  const engineOf = { kokoro, pocket, qwen3: { ...kokoro, id: "qwen3", name: "Qwen3-TTS" } };
  const known = {
    "kokoro-q8": { engine: engineOf.kokoro, variant: { need_gb: 1 } },
    "kokoro-bf16": { engine: engineOf.kokoro, variant: { need_gb: 1.2 } },
    "pocket-en": { engine: engineOf.pocket, variant: { need_gb: 0.5 } },
    "qwen3-big": { engine: engineOf.qwen3, variant: { need_gb: null } },
    "qwen3-small": { engine: engineOf.qwen3, variant: { need_gb: 3 } },
  };
  const factsOf = (id) => known[id] ?? null;
  const m = (id, mb) => ({ id, name: id, bytes: mb * 1024 * 1024 });
  const groups = [
    { key: "qwen3", label: "Qwen3-TTS", models: [m("qwen3-big", 3000), m("qwen3-small", 50)] },
    { key: "pocket", label: "Pocket TTS", models: [m("pocket-en", 250)] },
    { key: "kokoro", label: "Kokoro", models: [m("kokoro-bf16", 330), m("kokoro-q8", 120)] },
  ];
  const ordered = (by) => [...groups].sort((a, b) => groupOrder(a, b, by, factsOf)).map((g) => g.key);

  it("offers the engine list's four sorts, in its words", () => {
    expect(SORTS.map((s) => s.label)).toEqual(["Sort: name", "Sort: download size", "Sort: memory needed", "Sort: commercial use"]);
  });
  it("orders the engines by name, by default", () => {
    expect(ordered("name")).toEqual(["kokoro", "pocket", "qwen3"]);
    expect(ordered(undefined)).toEqual(["kokoro", "pocket", "qwen3"]);
  });
  it("by download size and by memory needed, each engine by its smallest model (unknown memory last)", () => {
    expect(ordered("size")).toEqual(["qwen3", "kokoro", "pocket"]);
    expect(ordered("memory")).toEqual(["pocket", "kokoro", "qwen3"]);
  });
  it("by commercial use, in the words' order (Yes first), then by name", () => {
    expect(ordered("commercial")).toEqual(["kokoro", "qwen3", "pocket"]);
  });
  it("inside an engine, size and memory order its models; name and commercial use keep the server's order", () => {
    const models = groups[0].models;
    const inside = (by) => [...models].sort((a, b) => modelOrder(a, b, by, factsOf)).map((x) => x.id);
    expect(inside("size")).toEqual(["qwen3-small", "qwen3-big"]);
    expect(inside("memory")).toEqual(["qwen3-small", "qwen3-big"]);
    expect(inside("name")).toEqual(["qwen3-big", "qwen3-small"]);
    expect(inside("commercial")).toEqual(["qwen3-big", "qwen3-small"]);
  });
});
