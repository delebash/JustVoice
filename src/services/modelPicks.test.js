// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The best picks' marks every model picker shows (docs/plans/2026-11-08-latest-models.md D12): the
// sets' own labels, the parts a model plays, the picks first in a picker and marked in a filter.
import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";

import ModelPickChips from "../components/ModelPickChips.vue";
import { groupedByPicks, hintedByPicks, labelWithPick, markText, pickOf, picksOfEngine, rolesText, sellableFirst } from "./modelPicks.js";

// GET /v1/book-voices/picks on the defaults (server tests/book_run.test.js pins the same answer).
const PICKS = [
  { model: "voxcpm2", engine: "voxcpm2", name: "VoxCPM2", set: "sell", label: "Best voices you can sell", sellable: true, commercial: "Yes", roles: ["characters"] },
  { model: "fish_drama3-fishdrama3", engine: "fish_drama3", name: "Fish Audio Drama 3", set: "sell", label: "Best voices you can sell", sellable: true, commercial: "Conditional", roles: ["narrator"] },
  { model: "breeze_tts", engine: "breeze_tts", name: "BreezeTTS 2", set: "best", label: "Best acting — not for sale", sellable: false, commercial: "Separate licence", roles: ["characters", "narrator"] },
];

test("a mark is its set's label and the parts the model plays", () => {
  expect(rolesText(["characters"])).toBe("plays the characters");
  expect(rolesText(["narrator"])).toBe("narrates");
  expect(rolesText(["characters", "narrator"])).toBe("plays the characters and narrates");
  expect(markText(PICKS[0])).toBe("Best voices you can sell · plays the characters");
  expect(markText(PICKS[2])).toBe("Best acting — not for sale · plays the characters and narrates");
  expect(pickOf(PICKS, "breeze_tts")?.set).toBe("best");
  expect(pickOf(PICKS, "kokoro")).toBeNull();
  expect(picksOfEngine(PICKS, "fish_drama3").map((p) => p.model)).toEqual(["fish_drama3-fishdrama3"]);
  // a maker starts on the sellable pick that plays the characters
  expect(sellableFirst(PICKS)).toEqual(["voxcpm2"]);
});

test("a model picker lists the picks first under their sets' labels, every option with its commercial use", () => {
  const options = [
    { label: "BreezeTTS 2 (not loaded)", value: "breeze_tts", commercial: "Separate licence", hint: "Written direction" },
    { label: "Chatterbox Turbo (not loaded)", value: "chatterbox-turbo", commercial: "Yes", hint: "Tags" },
    { label: "VoxCPM2 · loaded", value: "voxcpm2", commercial: "Yes", hint: "Written direction" },
  ];
  expect(groupedByPicks(options, PICKS)).toEqual([
    { label: "Best voices you can sell", options: [{ label: "VoxCPM2 · loaded", value: "voxcpm2", hint: "Best voices you can sell · plays the characters · Written direction · Commercial use: Yes" }] },
    {
      label: "Best acting — not for sale",
      options: [{ label: "BreezeTTS 2 (not loaded)", value: "breeze_tts", hint: "Best acting — not for sale · plays the characters and narrates · Written direction · Commercial use: Separate licence" }],
    },
    { label: "Other models", options: [{ label: "Chatterbox Turbo (not loaded)", value: "chatterbox-turbo", hint: "Tags · Commercial use: Yes" }] },
  ]);
  // none of the picks offered (a design model): the options as they were, their commercial use added
  expect(groupedByPicks([{ label: "Qwen3-TTS VoiceDesign", value: "qwen3-vd", commercial: "Yes" }], PICKS)).toEqual([
    { label: "Qwen3-TTS VoiceDesign", value: "qwen3-vd", hint: "Commercial use: Yes" },
  ]);
});

test("a model filter keeps its order and says the mark under a pick", () => {
  const options = [
    { label: "BreezeTTS 2 (12)", value: "breeze_tts" },
    { label: "Kokoro (54)", value: "kokoro" },
  ];
  expect(hintedByPicks(options, PICKS)).toEqual([
    { label: "BreezeTTS 2 (12)", value: "breeze_tts", hint: "Best acting — not for sale · plays the characters and narrates" },
    { label: "Kokoro (54)", value: "kokoro" },
  ]);
  // the Voices page filters by model name
  const byName = [{ label: "VoxCPM2 (3)", value: "VoxCPM2" }];
  expect(hintedByPicks(byName, PICKS, (o) => PICKS.find((p) => p.name === o.value)?.model)[0].hint).toBe("Best voices you can sell · plays the characters");
  expect(labelWithPick("VoxCPM2 (3)", PICKS[0])).toBe("VoxCPM2 (3) — Best voices you can sell · plays the characters");
  expect(labelWithPick("Kokoro (54)", null)).toBe("Kokoro (54)");
});

test("beside a chosen model: its mark and its commercial use, the not-for-sale mark in its own colour", () => {
  const sell = mount(ModelPickChips, { props: { pick: PICKS[1], licence: { name: "Fish Audio Research", commercial: "Conditional", summary: "Under USD 500,000 a year.", checked: "2026-11-08", table: "Conditional" } } });
  expect(sell.find(".ev-pick").text()).toBe("Best voices you can sell · narrates");
  expect(sell.find(".ev-pick").classes()).not.toContain("ev-pick--not-for-sale");
  expect(sell.find(".ev-lic").text()).toBe("Commercial use: Conditional");
  expect(sell.find(".ev-lic").classes()).toContain("ev-lic--warn");
  expect(sell.find(".ev-lic").attributes("title")).toContain("Under USD 500,000 a year.");

  const nfs = mount(ModelPickChips, { props: { pick: PICKS[2] } });
  expect(nfs.find(".ev-pick").classes()).toContain("ev-pick--not-for-sale");
  expect(nfs.find(".ev-lic").text()).toBe("Commercial use: Separate licence");

  // no pick: the commercial use alone; a voice's licence carries its summary as the hover
  const plain = mount(ModelPickChips, { props: { licence: { commercial: "Yes", summary: "Apache-2.0." } } });
  expect(plain.find(".ev-pick").exists()).toBe(false);
  expect(plain.find(".ev-lic").attributes("title")).toBe("Apache-2.0.");
  expect(mount(ModelPickChips, { props: {} }).html()).toBe("<!--v-if-->");
});
