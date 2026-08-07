// SPDX-License-Identifier: MIT
// The KIT's task queue, exercised as JustVoice is about to use it.
//
// JustVoice is deleting its own renderTasks/TaskStrip/TaskStatusPanel trio and moving
// its 17 task sites onto @delebash/llm-ui's shared queue. The three capabilities that
// move made the swap possible — linger, retry, per-task stats — and NONE of them had a
// caller when they were written, so every app's suite passed while proving nothing
// about them. This is that proof, and it lives here because JustVoice is the consumer
// that depends on the behaviour.
//
// The property worth guarding hardest is the LAST one: `runningCount` must not notice
// lingering tasks. JustWrite reads that count for its sidebar badge and ten of its
// components look tasks up through `runningTasks` (CritiqueModal.vue documents relying
// on a task LEAVING it on finish). If lingering ever leaks into those, JustWrite breaks
// and its own tests would not catch it.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAiTasksStore } from "@delebash/llm-ui";

const LINGER = { completed: 5000, cancelled: 3000, failed: null };

describe("kit task queue — the capabilities JustVoice's fork had", () => {
  let tasks;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    tasks = useAiTasksStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("without lingerMs a finished task archives immediately (JustWrite/docgen path)", () => {
    const h = tasks.start({ feature: "x", label: "no linger" });
    expect(tasks.runningCount).toBe(1);
    h.finish({});
    expect(tasks.runningCount).toBe(0);
    expect(tasks.visibleTasks).toHaveLength(0);
    expect(tasks.history[0].label).toBe("no linger");
  });

  it("a completed task lingers, stays OUT of runningTasks, then archives", () => {
    const h = tasks.start({ feature: "render", label: "Render", lingerMs: LINGER });
    h.finish({});
    // Visible so the strip can still be read, but NOT running — this is the split
    // that keeps JustWrite's badge and lookups honest.
    expect(tasks.visibleTasks).toHaveLength(1);
    expect(tasks.runningCount).toBe(0);
    expect(tasks.runningTasks).toHaveLength(0);

    vi.advanceTimersByTime(4999);
    expect(tasks.visibleTasks).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(tasks.visibleTasks).toHaveLength(0);
    expect(tasks.history[0].status).toBe("done");
  });

  it("a FAILED task with linger null stays until dismissed, and does not keep a ticker alive", () => {
    const h = tasks.start({ feature: "render", label: "Render", lingerMs: LINGER });
    h.fail(new Error("boom"));
    expect(tasks.visibleTasks).toHaveLength(1);
    expect(tasks.unseenErrors).toBe(1);

    // Ten minutes later it is still there — the user has to read it and clear it.
    vi.advanceTimersByTime(600_000);
    expect(tasks.visibleTasks).toHaveLength(1);

    tasks.dismiss(tasks.visibleTasks[0].id);
    expect(tasks.visibleTasks).toHaveLength(0);
    expect(tasks.history[0].error).toContain("boom");
  });

  it("dismiss refuses to touch a RUNNING task", () => {
    const h = tasks.start({ feature: "x", label: "live", lingerMs: LINGER });
    tasks.dismiss(h.id);
    expect(tasks.runningCount).toBe(1);
    h.finish({});
    tasks.dismiss(h.id);
    expect(tasks.visibleTasks).toHaveLength(0);
  });

  it("retry archives the old row and runs the callback once", () => {
    const again = vi.fn();
    const h = tasks.start({ feature: "x", label: "Render", lingerMs: LINGER, onRetry: again });
    h.fail(new Error("nope"));
    const id = tasks.visibleTasks[0].id;

    tasks.retry(id);
    expect(again).toHaveBeenCalledTimes(1);
    // The old row is gone rather than sitting beside its own re-run.
    expect(tasks.visibleTasks.find((t) => t.id === id)).toBeUndefined();
  });

  it("retry is a no-op when no callback was supplied", () => {
    const h = tasks.start({ feature: "x", label: "Render", lingerMs: LINGER });
    h.finish({});
    const id = tasks.visibleTasks[0].id;
    expect(() => tasks.retry(id)).not.toThrow();
    expect(tasks.visibleTasks).toHaveLength(1);
  });

  it("stats are plain strings, replaceable mid-run, and survive into history", () => {
    const h = tasks.start({ feature: "render", label: "Render", stats: ["120 chars"], lingerMs: LINGER });
    expect(tasks.visibleTasks[0].stats).toEqual(["120 chars"]);

    // The shape JustVoice needs: the byte count only exists once the blob lands.
    h.setStats(["120 chars", "3.2 KB", "1.4s audio"]);
    expect(tasks.visibleTasks[0].stats).toEqual(["120 chars", "3.2 KB", "1.4s audio"]);

    h.finish({});
    vi.advanceTimersByTime(6000);
    expect(tasks.history[0].stats).toEqual(["120 chars", "3.2 KB", "1.4s audio"]);
  });

  it("update merges meta and patches a task that has already finished", () => {
    const h = tasks.start({ feature: "render", label: "Render", meta: { words: 12 }, lingerMs: LINGER });
    h.finish({});
    h.update({ meta: { bytesOut: 4096 } });
    const t = tasks.visibleTasks[0];
    expect(t.meta).toEqual({ words: 12, bytesOut: 4096 });
  });

  it("the 500ms ticker STOPS once nothing is running, even with a task still lingering", () => {
    // The reason the ticker gate counts running tasks instead of order.length. With
    // `failed: null` a row stays until dismissed, so a length-gated ticker would run
    // forever behind it — the runaway JustVoice's own renderTasks comment records
    // fixing. Asserted rather than asserted-in-a-commit-message: the interval is
    // module-scope and can't be read directly, so count live timers instead.
    const h = tasks.start({ feature: "render", label: "Render", lingerMs: LINGER });
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the ticker is up

    h.fail(new Error("boom"));
    // Lingering forever (failed: null) means no archive timeout was scheduled either,
    // so a still-running ticker would be the ONLY live timer. There must be none.
    expect(tasks.visibleTasks).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    // And it comes back for the next real run.
    tasks.start({ feature: "render", label: "Another", lingerMs: LINGER });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("a lingering task never inflates runningCount, even beside a live one", () => {
    const done = tasks.start({ feature: "a", label: "finished", lingerMs: LINGER });
    const live = tasks.start({ feature: "b", label: "still going", lingerMs: LINGER });
    done.finish({});

    expect(tasks.runningCount).toBe(1);
    expect(tasks.runningTasks.map((t) => t.label)).toEqual(["still going"]);
    expect(tasks.visibleTasks).toHaveLength(2);
    expect(tasks.isRunning(live.id)).toBe(true);
    expect(tasks.isRunning(done.id)).toBe(false);
  });
});
