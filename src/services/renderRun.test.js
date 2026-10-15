// SPDX-License-Identifier: MIT
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiTasksStore } from "@delebash/llm-ui";
import {
  QC_WAITS, chapterRenderTask, chapterRunning, clock, followJob, followRender, jobFollowed, loadingText, mediaUrl, runFigures, waitingText,
} from "./renderRun.js";

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

  // A transport that behaves as fetch does: a GET takes `getMs`, and rejects
  // with AbortError when its signal aborts before or while it runs.
  function abortingApi(getMs) {
    const calls = [];
    return {
      calls,
      request: vi.fn((path, { signal } = {}) => new Promise((resolve, reject) => {
        calls.push(path);
        const aborted = () => new DOMException("The operation was aborted.", "AbortError");
        if (signal?.aborted) return reject(aborted());
        const t = setTimeout(() => resolve({ id: "job1", status: "running", completed_blocks: 0, total_blocks: 5 }), getMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(aborted());
        }, { once: true });
      })),
      safeRequest: vi.fn(async (path, fallback, opts) => {
        calls.push(`${opts?.method || "GET"} ${path}`);
        return fallback;
      }),
    };
  }

  it("cancels the job on the server when Cancel lands during the wait after a poll", async () => {
    const api = abortingApi(100);
    const ctl = new AbortController();
    const run = followJob(api, { id: "job1", status: "running" }, { signal: ctl.signal });
    const settled = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(700 + 100 + 200); // one poll done, the next wait under way
    ctl.abort();
    await vi.runAllTimersAsync();
    await settled;
    expect(api.calls).toEqual(["/v1/render_jobs/job1?include_blocks=true", "POST /v1/render_jobs/job1/cancel"]);
  });

  it("cancels the job on the server when Cancel lands during a poll's request", async () => {
    const api = abortingApi(100);
    const ctl = new AbortController();
    const run = followJob(api, { id: "job1", status: "running" }, { signal: ctl.signal });
    const settled = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(700 + 100 + 700 + 50); // one poll done, the second in flight
    ctl.abort();
    await vi.runAllTimersAsync();
    await settled;
    expect(api.calls).toEqual([
      "/v1/render_jobs/job1?include_blocks=true",
      "/v1/render_jobs/job1?include_blocks=true",
      "POST /v1/render_jobs/job1/cancel",
    ]);
  });
});

describe("a render started elsewhere (2026-10-13, the narrowings review R3)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("is followed as this window's own run: its task, its lines, its end", async () => {
    const api = fakeApi([
      { status: "running", completed_blocks: 1, failed_blocks: 0, total_blocks: 2, blocks: [{ block_id: "b1", status: "completed" }] },
      { status: "completed", completed_blocks: 2, failed_blocks: 0, total_blocks: 2 },
    ]);
    const tasks = useAiTasksStore();
    const run = followRender(api, {
      sceneId: "s1", title: "3 · The Keystone",
      job: { id: "job1", status: "running", completed_blocks: 0, failed_blocks: 0, total_blocks: 2 },
    });
    expect(chapterRunning(tasks, "s1")).toBe(true);
    expect(chapterRunning(tasks, "s2")).toBe(false);
    const task = tasks.visibleTasks[0];
    expect([task.feature, task.label, task.meta]).toEqual(["render-lines", "3 · The Keystone", { sceneId: "s1", jobId: "job1" }]);
    await vi.runAllTimersAsync();
    expect((await run).status).toBe("completed");
    expect(chapterRunning(tasks, "s1")).toBe(false);
  });

  it("is followed once when it spans several chapters (2026-10-13, the implementation review's problem 8)", async () => {
    const api = fakeApi([
      { status: "running", completed_blocks: 0, failed_blocks: 0, total_blocks: 4 },
      { status: "completed", completed_blocks: 4, failed_blocks: 0, total_blocks: 4 },
    ]);
    const tasks = useAiTasksStore();
    expect(jobFollowed(tasks, "job1")).toBe(false);
    const run = followRender(api, { sceneId: "s1", title: "1 · Brass Rank", job: { id: "job1", status: "running" } });
    expect(jobFollowed(tasks, "job1")).toBe(true); // so chapter 2, the same job, isn't adopted again
    expect(chapterRunning(tasks, "s2")).toBe(false);
    expect(jobFollowed(tasks, "job2")).toBe(false);
    await vi.runAllTimersAsync();
    await run;
    expect(jobFollowed(tasks, "job1")).toBe(false);
  });

  it("reads as rendering on each chapter of a job over several, with one task (2026-10-15)", async () => {
    // The answer to how a render over several chapters shows (the narrowings review R3):
    // "rendering…" on each of its chapters, with one progress strip.
    const api = fakeApi([
      { status: "running", completed_blocks: 0, failed_blocks: 0, total_blocks: 6 },
      { status: "completed", completed_blocks: 6, failed_blocks: 0, total_blocks: 6 },
    ]);
    const tasks = useAiTasksStore();
    const run = followRender(api, { sceneId: "s1", title: "1 · Brass Rank", job: { id: "job1", status: "running" } });
    const one = chapterRenderTask(tasks, "s1");
    expect(one?.meta).toEqual({ sceneId: "s1", jobId: "job1" });
    expect(chapterRenderTask(tasks, "s2", "job1")).toBe(one); // the job over chapter 2: the same one task
    expect(chapterRenderTask(tasks, "s2")).toBeNull(); // no job over it
    expect(chapterRenderTask(tasks, "s3", "job2")).toBeNull(); // another job, not followed here
    expect(tasks.visibleTasks.length).toBe(1);
    await vi.runAllTimersAsync();
    await run;
    expect(chapterRenderTask(tasks, "s2", "job1")).toBeNull(); // ended
  });

  it("offers Cancel: cancelling the task cancels the job on the server", async () => {
    const api = fakeApi([{ status: "running", completed_blocks: 0, failed_blocks: 0, total_blocks: 5 }]);
    const tasks = useAiTasksStore();
    const run = followRender(api, { sceneId: "s1", title: "3 · The Keystone", job: { id: "job1", status: "running" } });
    tasks.cancel(tasks.visibleTasks[0].id);
    const settled = expect(run).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    await settled;
    expect(api.calls).toContain("POST /v1/render_jobs/job1/cancel");
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
    ] })).toBe("waiting — 2 · Bigger Inside is ahead: 40 lines on Chatterbox Turbo, and 1 more line");
  });
  it("says only the first when nothing more is ahead", () => {
    expect(waitingText({ lines: 40, groups: [
      { label: "2 · Bigger Inside", kind: "chapter", model: "Chatterbox Turbo", lines: 40 },
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

describe("what a loading line says (2026-10-07)", () => {
  it("names the model and how long it has been loading", () => {
    expect(loadingText({ model: "Qwen3-TTS CustomVoice", seconds: 7.6 })).toBe("loading Qwen3-TTS CustomVoice — 8 s");
  });
  it("says nothing when no model is loading", () => {
    expect(loadingText(null)).toBe("");
  });
});

describe("🎧 Run ACX QC's hover while it waits (2026-10-15)", () => {
  it("is the user's words (the narrowings review B3)", () => {
    expect(QC_WAITS).toBe("Waits for the render to finish — the check renders lines that have no take.");
  });
});

describe("mediaUrl", () => {
  it("puts a take's audio path on the server's address", () => {
    expect(mediaUrl({ serverUrl: "http://127.0.0.1:17494/" }, "/v1/generations/g1/audio"))
      .toBe("http://127.0.0.1:17494/v1/generations/g1/audio");
    expect(mediaUrl({ serverUrl: "" }, null)).toBeNull();
  });
});
