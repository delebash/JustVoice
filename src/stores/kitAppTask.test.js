// SPDX-License-Identifier: MIT
// The kit's withAiTask / runAiEndpoint runners (services/appTask.js) — the seam
// every JustVoice AI/long-task call now rides (AI-call convention 2026-08-08).
// Sibling of kitTaskQueue.test.js, which covers the store itself; this file
// covers the LIFECYCLE OWNERSHIP the runners took away from app code — above
// all that usage reaches finish(), because 17 hand-rolled sites dropped it and
// no LLM task ever showed a token.

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { runAiEndpoint, toTaskUsage, useAiTasksStore, withAiTask } from "@delebash/llm-ui";

beforeEach(() => {
  setActivePinia(createPinia());
});

const lastArchived = (tasks) => tasks.history[0];  // archive rows carry status: done | failed | cancelled

describe("toTaskUsage", () => {
  it("accepts the family's snake_case RunUsage", () => {
    expect(toTaskUsage({ prompt_tokens: 7, completion_tokens: 3 })).toEqual({
      promptTokens: 7,
      completionTokens: 3,
    });
  });

  it("accepts camelCase (the /v1/ai shape)", () => {
    expect(toTaskUsage({ promptTokens: 5, completionTokens: 2 })).toEqual({
      promptTokens: 5,
      completionTokens: 2,
    });
  });

  it("returns null for absent or all-zero usage — 'not reported' stays distinguishable", () => {
    expect(toTaskUsage(null)).toBe(null);
    expect(toTaskUsage({})).toBe(null);
    expect(toTaskUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBe(null);
  });
});

describe("withAiTask", () => {
  it("finishes with the callback's usage — tokens reach the task", async () => {
    const tasks = useAiTasksStore();
    const out = await withAiTask(
      { feature: "speaker_attribution", label: "Analyze", lingerMs: {} },
      async () => ({ result: { rows: [1, 2] }, usage: { prompt_tokens: 900, completion_tokens: 120 } }),
    );
    expect(out).toEqual({ rows: [1, 2] });
    const t = lastArchived(tasks);
    expect(t.status).toBe("done");
    expect(t.tokensIn).toBe(900);
    expect(t.tokensOut).toBe(120);
  });

  it("returns a bare (unwrapped) result untouched", async () => {
    const blobish = { size: 123 };
    const out = await withAiTask({ feature: "generate", label: "Render", lingerMs: {} }, async () => blobish);
    expect(out).toBe(blobish);
  });

  it("fails with the ORIGINAL error — app endpoints' messages and status survive", async () => {
    const tasks = useAiTasksStore();
    const boom = new Error("Scene has no blocks to classify — analyze + apply first.");
    boom.status = 400;
    await expect(
      withAiTask({ feature: "preset-suggest", label: "Suggest", lingerMs: {} }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    // lingerMs: {} archives every outcome immediately, so the failed row is
    // already history (under the family default it would linger until dismissed).
    const t = lastArchived(tasks);
    expect(t.status).toBe("error");  // the store's failed-status literal
    expect(t.error).toMatch(/Scene has no blocks/);
  });

  it("classifies an abort as cancelled, never as a red failure", async () => {
    const tasks = useAiTasksStore();
    await expect(
      withAiTask({ feature: "acx-qc", label: "QC", lingerMs: {} }, async (task) => {
        task.cancel();
        const e = new Error("The user aborted a request.");
        throw e;
      }),
    ).rejects.toThrow(/aborted/);
    expect(lastArchived(tasks).status).toBe("cancelled");
  });

  it("a callback that cancels and returns leaves a cancelled row (first outcome wins)", async () => {
    const tasks = useAiTasksStore();
    await withAiTask({ feature: "install", label: "Install", lingerMs: {} }, async (task) => {
      task.cancel(); // the job channel reported cancelled without throwing
    });
    expect(lastArchived(tasks).status).toBe("cancelled");
  });

  it("ORs an outer signal into the task (the JW batch-owner shape)", async () => {
    const tasks = useAiTasksStore();
    const outer = new AbortController();
    const run = withAiTask(
      { feature: "readerKnowledge", label: "Sweep", signal: outer.signal, lingerMs: {} },
      async (task) => {
        outer.abort();
        expect(task.signal.aborted).toBe(true);
      },
    );
    await run;
    expect(lastArchived(tasks).status).toBe("cancelled");
  });
});

describe("runAiEndpoint", () => {
  it("POSTs through the app transport and surfaces the response's snake_case usage", async () => {
    const tasks = useAiTasksStore();
    const seen = {};
    const fakeRequest = async (path, opts) => {
      seen.path = path;
      seen.opts = opts;
      return { rows: [], usage: { prompt_tokens: 42, completion_tokens: 6, model: "m1" } };
    };
    const r = await runAiEndpoint({
      request: fakeRequest,
      path: "/v1/scenes/s1/analyze",
      body: { text: "hi" },
      task: { feature: "speaker_attribution", label: "Analyze", lingerMs: {} },
    });
    expect(r.usage.model).toBe("m1");
    expect(seen.path).toBe("/v1/scenes/s1/analyze");
    expect(JSON.parse(seen.opts.body)).toEqual({ text: "hi" });
    expect(seen.opts.signal).toBeInstanceOf(AbortSignal);
    const t = lastArchived(tasks);
    expect(t.tokensIn).toBe(42);
    expect(t.tokensOut).toBe(6);
    expect(t.model).toBe("m1");
  });
});
