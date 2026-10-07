// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savedMessage } from "./exportRun.js";

describe("what an export's save says (2026-10-07)", () => {
  it("names the file and its folder when the Save dialog saved it", () => {
    expect(savedMessage({ ok: true, path: "D:\\Books\\The_Ninth_Facet.m4b" }, "The_Ninth_Facet.m4b"))
      .toEqual({ kind: "success", message: "Saved The_Ninth_Facet.m4b to D:\\Books\\The_Ninth_Facet.m4b", folder: "D:\\Books" });
  });
  it("says Downloads when there was no dialog to ask", () => {
    expect(savedMessage({ ok: true, downloaded: true }, "b.zip").message).toBe("Saved b.zip to your Downloads folder.");
  });
  it("never says exported when the dialog was cancelled", () => {
    expect(savedMessage({ ok: false, cancelled: true }, "b.m4b"))
      .toEqual({ kind: "info", message: "Export cancelled — nothing was saved.", folder: null });
  });
});
