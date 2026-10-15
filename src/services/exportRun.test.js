// SPDX-License-Identifier: MIT
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiTasksStore } from "@delebash/llm-ui";
import { exportRun, savedMessage } from "./exportRun.js";

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

describe("an export run (2026-10-15)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const NOTE = "No masters — ffmpeg isn't installed, so the zip holds the chapter WAVs only.";
  /** The server's job, step by step: the start answer, then each poll. */
  function fakeApi(jobs) {
    return {
      request: vi.fn(async () => jobs.shift()),
      requestBlob: vi.fn(async () => new Blob(["zip"])),
      safeRequest: vi.fn(async () => null),
    };
  }

  it("says what Cancel does: at once while lines render, else after the chapter being mastered", async () => {
    // "Cancel stops after the chapter it is on" stopped being true when Cancel reached the render
    // phase (2026-10-13); the user's words replace it.
    const api = fakeApi([
      { id: "j1", status: "running", done: 1, total: 3, step: "Rendering line 2 of 3" },
      { id: "j1", status: "done", done: 1, total: 1, step: "Done", filename: "B.m4b", note: null },
    ]);
    const tasks = useAiTasksStore();
    const run = exportRun(api, { id: "p1", name: "B" }, "m4b");
    await vi.advanceTimersByTimeAsync(0);
    expect(tasks.visibleTasks[0].progress.hint).toBe(
      "Chapters joined and mastered, then the book encoded — Cancel stops at once while lines render, or after the chapter being mastered.",
    );
    await vi.runAllTimersAsync();
    expect((await run).note).toBeNull();
  });

  it("hands over the chapter zip with the server's note when it has no masters (R8)", async () => {
    const api = fakeApi([
      { id: "j2", status: "running", done: 0, total: 2, step: "Starting", note: NOTE },
      { id: "j2", status: "done", done: 2, total: 2, step: "Done", filename: "B chapters.zip", note: NOTE },
    ]);
    const tasks = useAiTasksStore();
    const run = exportRun(api, { id: "p1", name: "B" }, "chapters");
    await vi.advanceTimersByTimeAsync(0);
    expect(tasks.visibleTasks[0].progress.hint).toBe(
      "Each chapter joined, then mastered — Cancel stops at once while lines render, or after the chapter being mastered.",
    );
    await vi.runAllTimersAsync();
    const out = await run;
    expect([out.filename, out.note]).toEqual(["B chapters.zip", NOTE]);
    expect(api.requestBlob).toHaveBeenCalledWith("/v1/export_jobs/j2/file", expect.anything());
  });
});
