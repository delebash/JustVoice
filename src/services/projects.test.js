// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { packageName } from "./projects.js";

describe("Overview's project package name (2026-10-15, the narrowings review R7)", () => {
  it("is the project's name as written, minus only what a Windows file name can't hold", () => {
    expect(packageName("The Ninth Facet")).toBe("The Ninth Facet.justvoice.zip"); // "The-Ninth-Facet" before
    expect(packageName(`Война: "the" Wizard's Tale?`)).toBe("Война the Wizard's Tale.justvoice.zip");
  });
  it("says project when nothing is left of the name, as before", () => {
    expect(packageName("???")).toBe("project.justvoice.zip");
    expect(packageName("")).toBe("project.justvoice.zip");
  });
});
