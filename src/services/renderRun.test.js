// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clock, followJob, mediaUrl, runFigures, waitingText } from "./renderRun.js";

function fakeApi(statuses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    serverUrl: "http://127.0.0.1:17494/",
    request: vi.fn(async (path) => {
      calls.push(path);
      i = Math.min(i + 1, statuses.length - 1);
      return { id: "job1", ...statuses[i] };
    }),
    safeRequest: vi.fn(async (path, fallback, opts) => {
      calls.push(`${opts?.method || "GET"} ${path}`);
      return fallback;
    }),
  };
}

describe("followJob", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls a render job until it ends, reporting every step", async () => {
    const api = fakeApi([
      { status: "queued", completed_blocks: 0, failed_blocks: 0, total_blocks: 3 },
      { status: "running", completed_blocks: 1, failed_blocks: 0, total_blocks: 3 },
      { status: "completed", completed_blocks: 3, failed_blocks: 0, total_blocks: 3 },
    ]);
    const seen = [];
    const done = followJob(api, { id: "job1", status: "queued", completed_blocks: 0, failed_blocks: 0, total_blocks: 3 },
      { onProgress: (j) => seen.push(`${j.status}:${j.completed_blocks}`) });
    await vi.runAllTimersAsync();
    expect((await done).status).toBe("completed");
    expect(seen).toEqual(["queued:0", "running:1", "completed:3"]);
    expect(api.calls).toEqual(["/v1/render_jobs/job1?include_blocks=true", "/v1/render_jobs/job1?include_blocks=true"]);
  });

  it("returns at once for a job born finished (nothing to render)", async () => {
    const api = fakeApi([{ status: "completed" }]);
    const out = await followJob(api, { id: "job1", status: "completed", total_blocks: 0 });
    expect(out.status).toBe("completed");
    expect(api.request).not.toHaveBeenCalled();
  });

  it("cancels the job on the server when the task is cancelled", async () => {
    const api = fakeApi([{ status: "running", completed_blocks: 0, failed_blocks: 0, total_blocks: 5 }]);
    const ctl = new AbortController();
    ctl.abort();
    await expect(followJob(api, { id: "job1", status: "running" }, { signal: ctl.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(api.calls).toEqual(["POST /v1/render_jobs/job1/cancel"]);
  });
});

describe("a run's figures (2026-10-07)", () => {
  it("say the audio made, its speed against real time, and the time left", () => {
    const job = { audio_seconds: 192, completed_blocks: 30, failed_blocks: 0, total_blocks: 90 };
    expect(runFigures(job, 80)).toEqual(["3:12 of audio", "2.4× real time", "about 3 min left"]);
  });
  it("say nothing before the first line lands, and no time left at the end", () => {
    expect(runFigures({ audio_seconds: 0, completed_blocks: 0, failed_blocks: 0, total_blocks: 9 }, 4)).toEqual([]);
    expect(runFigures({ audio_seconds: 30, completed_blocks: 9, failed_blocks: 0, total_blocks: 9 }, 10))
      .toEqual(["0:30 of audio", "3.0× real time"]);
  });
  it("count seconds under a minute", () => {
    expect(runFigures({ audio_seconds: 10, completed_blocks: 4, failed_blocks: 0, total_blocks: 6 }, 20))
      .toContain("about 10 s left");
  });
  it("reads a long run as hours", () => {
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(59.6)).toBe("1:00");
  });
});

describe("what a waiting run says (2026-10-07)", () => {
  it("names a chapter ahead, its lines and its model", () => {
    expect(waitingText({ lines: 41, groups: [
      { label: "2 · Bigger Inside", kind: "chapter", model: "Chatterbox Turbo", lines: 40 },
      { label: "the M4B export", kind: "work", model: "Kokoro", lines: 1 },
    ] })).toBe("waiting — 2 · Bigger Inside is ahead: 40 lines on Chatterbox Turbo");
  });
  it("says other work is rendering first", () => {
    expect(waitingText({ lines: 12, groups: [{ label: "the M4B export", kind: "work", model: "Kokoro", lines: 12 }] }))
      .toBe("waiting — the M4B export is rendering 12 lines first");
    expect(waitingText({ lines: 1, groups: [{ label: "a voice preview", kind: "work", model: null, lines: 1 }] }))
      .toBe("waiting — a voice preview is rendering 1 line first");
  });
  it("says nothing when nothing is ahead", () => {
    expect(waitingText(null)).toBe("");
    expect(waitingText({ lines: 0, groups: [] })).toBe("");
  });
});

describe("mediaUrl", () => {
  it("puts a take's audio path on the server's address", () => {
    expect(mediaUrl({ serverUrl: "http://127.0.0.1:17494/" }, "/v1/generations/g1/audio"))
      .toBe("http://127.0.0.1:17494/v1/generations/g1/audio");
    expect(mediaUrl({ serverUrl: "" }, null)).toBeNull();
  });
});
