// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runServerJob } = vi.hoisted(() => ({ runServerJob: vi.fn() }));
vi.mock("@delebash/ui", () => ({ runServerJob }));
const { exportRun, savedMessage } = await import("./exportRun.js");

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

describe("an export run — a server job on the kit's registry (round E, plan §4 step 6)", () => {
  const NOTE = "No masters — ffmpeg isn't installed, so the zip holds the chapter WAVs only.";
  /** The kit's runServerJob as it runs one: start, a reading while it runs, then its result. */
  function serverJob(end) {
    return vi.fn(async ({ start, describe }) => {
      const job = await start();
      seen.started = job;
      seen.phase = describe({ ...job, state: "running", message: "Rendering line 2 of 3" }, 40);
      return end;
    });
  }
  const seen = {};
  beforeEach(() => {
    runServerJob.mockReset();
    for (const k of Object.keys(seen)) delete seen[k];
  });
  const fakeApi = () => ({
    post: vi.fn(async () => ({ id: "j1", state: "running", progress: 0, message: "", data: {} })),
    requestBlob: vi.fn(async () => new Blob(["zip"])),
  });

  it("starts the M4B on the book's route, its strip the export's, saying each step", async () => {
    const api = fakeApi();
    runServerJob.mockImplementation(serverJob({ filename: "B.m4b", note: null }));
    const out = await exportRun(api, { id: "p1", name: "B" }, "m4b");
    expect(api.post).toHaveBeenCalledWith("/v1/projects/p1/export_m4b/start", {});
    expect(runServerJob).toHaveBeenCalledWith(expect.objectContaining({ feature: "export-m4b", label: "B → M4B audiobook", meta: { projectId: "p1" } }));
    // the strip's note: what it does and what Cancel does (the user's words, 2026-10-15)
    expect(runServerJob.mock.calls[0][0].note).toBe(
      "Chapters joined and mastered, then the book encoded — Cancel stops at once while lines render, or after the chapter being mastered.",
    );
    expect(seen.phase).toBe("Rendering line 2 of 3");
    expect(api.requestBlob).toHaveBeenCalledWith("/v1/export_jobs/j1/file");
    expect([out.filename, out.note]).toEqual(["B.m4b", null]);
  });

  it("hands over the chapter zip with the server's note when it has no masters (R8)", async () => {
    const api = fakeApi();
    runServerJob.mockImplementation(serverJob({ filename: "B chapters.zip", note: NOTE }));
    const out = await exportRun(api, { id: "p1", name: "B" }, "chapters");
    expect(api.post).toHaveBeenCalledWith("/v1/projects/p1/export_chapters/start", {});
    expect(runServerJob).toHaveBeenCalledWith(expect.objectContaining({ feature: "export-chapters" }));
    expect(runServerJob.mock.calls[0][0].note).toBe("Each chapter joined, then mastered — Cancel stops at once while lines render, or after the chapter being mastered.");
    expect([out.filename, out.note]).toEqual(["B chapters.zip", NOTE]);
  });

  it("a cancel fetches nothing", async () => {
    const api = fakeApi();
    runServerJob.mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    await expect(exportRun(api, { id: "p1", name: "B" }, "m4b")).rejects.toThrow("cancelled");
    expect(api.requestBlob).not.toHaveBeenCalled();
  });
});
