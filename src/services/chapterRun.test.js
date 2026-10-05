// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from "vitest";

// The run's model calls, held open until a test settles them.
const calls = [];
function held({ task }) {
  return new Promise((resolve, reject) => {
    calls.push({ task, resolve });
    task.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}
vi.mock("@delebash/llm-ui", () => ({
  pushToast: vi.fn(),
  runAiEndpoint: vi.fn((o) => held(o)),
  runAiEndpointStream: vi.fn((o) => held(o)),
}));
vi.mock("../stores/api.js", () => ({
  useApi: () => ({ serverUrl: "", safeRequest: async () => [], request: async () => ({}) }),
}));

const { cancelRun, inRun, queueChapters, runStripTask, stepRun } = await import("./chapterRun.js");
const { pageTasks } = await import("./pageTasks.js");
const { hasNarrator, narrationOf } = await import("./narrator.js");

const settle = () => new Promise((r) => setTimeout(r, 0));
const chapter = (id) => ({ id, title: id.toUpperCase(), metadata: { source_text: `The text of ${id}.` } });

function store(list, running = []) {
  return { visibleTasks: list, isRunning: (id) => running.includes(id) };
}
const task = (id, sceneId, feature = "speaker_identification", projectId = "p1") =>
  ({ id, inline: true, feature, meta: { run: true, projectId, sceneId } });

describe("runStripTask", () => {
  it("follows the chapter running now, not a finished one listed first (2026-10-05)", () => {
    const tasks = store([task("t1", "a"), task("t2", "b"), task("t3", "c")], ["t3"]);
    expect(runStripTask(tasks, "p1", "discover").id).toBe("t3");
  });

  it("falls back to the step's last one that finished when nothing runs", () => {
    expect(runStripTask(store([task("t1", "a"), task("t2", "b")]), "p1", "discover").id).toBe("t2");
  });

  it("shows only its own step, one book only, one chapter when asked (2026-10-05)", () => {
    const tasks = store([task("t1", "a", "speaker_attribution"), task("t2", "b"),
      task("t3", "c", "speaker_identification", "p2"),
      { id: "t4", inline: true, feature: "rewrite", meta: { run: true, projectId: "p1" } }], ["t1", "t2"]);
    expect(runStripTask(tasks, "p1", "analyze").id).toBe("t1");
    expect(runStripTask(tasks, "p1", "discover").id).toBe("t2");
    expect(runStripTask(tasks, "p1", "analyze", "b")).toBeNull();
    expect(runStripTask(store([]), "p1", "discover")).toBeNull();
  });
});

describe("pageTasks", () => {
  it("picks a page's tasks by feature and by every meta key it stamped", () => {
    const tasks = store([
      { id: "a", feature: "smart_assign", meta: { projectId: "p1" } },
      { id: "b", feature: "smart_assign", meta: { projectId: "p2" } },
      { id: "c", feature: "show-notes", meta: {} },
    ]);
    expect(pageTasks(tasks, ["smart_assign"], { projectId: "p1" }).map((t) => t.id)).toEqual(["a"]);
    expect(pageTasks(tasks, ["show-notes", "smart_assign"]).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the chapter run — each step its own part (2026-10-05)", () => {
  beforeEach(() => { calls.length = 0; });

  it("queues a chapter once per step, counts each step, and says when a step waits", async () => {
    expect(queueChapters({ projectId: "q1", kind: "analyze", chapters: [chapter("a"), chapter("b")] })).toBe(2);
    await settle();
    // Script is analyzing a; Discover can still take a, and waits.
    expect(queueChapters({ projectId: "q1", kind: "discover", chapters: [chapter("a"), chapter("c")] })).toBe(2);
    expect(queueChapters({ projectId: "q1", kind: "discover", chapters: [chapter("a")] })).toBe(0);
    expect(inRun("q1", "a", "analyze")).toBe("current");
    expect(inRun("q1", "a", "discover")).toBe("queued");
    expect(inRun("q1", "a")).toBe("current");
    expect(stepRun("q1", "analyze")).toMatchObject({ running: true, waiting: false, total: 2, finished: 0 });
    expect(stepRun("q1", "discover")).toMatchObject({ running: false, waiting: true, queued: 2, total: 2 });
    // The strip carries the chapter, never the step's "n of N".
    expect(calls[0].task.label).toBe("Script · analyze · A");
    expect(calls[0].task.stats.join(" ")).not.toMatch(/ of /);

    calls[0].resolve({});
    await settle();
    expect(stepRun("q1", "analyze")).toMatchObject({ running: true, finished: 1, total: 2 });
    expect(inRun("q1", "b", "analyze")).toBe("current");
  });

  it("Cancel stops one step's chapters; the other step's go on", async () => {
    queueChapters({ projectId: "q2", kind: "analyze", chapters: [chapter("a"), chapter("b")] });
    await settle();
    queueChapters({ projectId: "q2", kind: "discover", chapters: [chapter("c")] });
    cancelRun("q2", "analyze");
    await settle();
    await settle();
    expect(stepRun("q2", "analyze")).toBeNull();
    expect(inRun("q2", "b")).toBeNull();
    expect(stepRun("q2", "discover")).toMatchObject({ running: true, total: 1 });
    expect(calls.at(-1).task.label).toBe("Discover · scan · C");
    expect(calls.at(-1).task.signal.aborted).toBe(false);
  });
});

describe("narrator", () => {
  it("counts narration as read lines that are not spoken, and finds the narrator", () => {
    expect(narrationOf([{ lines: 78, spoken: 35 }, { lines: 0 }, { lines: 5, spoken: 6 }])).toBe(43);
    expect(hasNarrator([{ narrator: false }, { narrator: true }])).toBe(true);
    expect(hasNarrator([])).toBe(false);
  });
});
