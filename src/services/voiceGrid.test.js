// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { voiceRowState } from "./voiceGrid.js";

describe("voiceRowState", () => {
  const row = { id: "v1" };

  it("marks nothing on an ordinary row", () => {
    expect(voiceRowState(row, [], "")).toEqual({
      "row-orphan": false,
      "voices-view__row--playing": false,
    });
  });

  it("marks an orphan", () => {
    expect(voiceRowState(row, ["v1"], "")["row-orphan"]).toBe(true);
  });

  it("marks the row that is playing, and only that row", () => {
    expect(voiceRowState(row, [], "v1")["voices-view__row--playing"]).toBe(true);
    expect(voiceRowState({ id: "v2" }, [], "v1")["voices-view__row--playing"]).toBe(false);
  });

  it("never marks a row with no id as playing", () => {
    // "" === "" would otherwise light up every id-less row the moment nothing
    // is playing.
    expect(voiceRowState({}, [], "")["voices-view__row--playing"]).toBe(false);
  });

  it("survives a missing orphan list", () => {
    expect(voiceRowState(row, undefined, "")["row-orphan"]).toBe(false);
  });

  it("can carry both states at once", () => {
    expect(voiceRowState(row, ["v1"], "v1")).toEqual({
      "row-orphan": true,
      "voices-view__row--playing": true,
    });
  });
});
