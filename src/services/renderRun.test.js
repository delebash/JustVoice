// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followJob, mediaUrl } from "./renderRun.js";

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
    expect(api.calls).toEqual(["/v1/render_jobs/job1", "/v1/render_jobs/job1"]);
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

describe("mediaUrl", () => {
  it("puts a take's audio path on the server's address", () => {
    expect(mediaUrl({ serverUrl: "http://127.0.0.1:17494/" }, "/v1/generations/g1/audio"))
      .toBe("http://127.0.0.1:17494/v1/generations/g1/audio");
    expect(mediaUrl({ serverUrl: "" }, null)).toBeNull();
  });
});
