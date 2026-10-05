// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { runStripTask } from "./chapterRun.js";
import { hasNarrator, narrationOf } from "./narrator.js";

function store(list, running = []) {
  return { visibleTasks: list, isRunning: (id) => running.includes(id) };
}
const task = (id, sceneId, feature = "speaker_identification", projectId = "p1") =>
  ({ id, inline: true, feature, meta: { run: true, projectId, sceneId } });

describe("runStripTask", () => {
  it("follows the chapter running now, not a finished one listed first (2026-10-05)", () => {
    const tasks = store([task("t1", "a"), task("t2", "b"), task("t3", "c")], ["t3"]);
    expect(runStripTask(tasks, "p1").id).toBe("t3");
  });

  it("falls back to the last one that finished when nothing runs", () => {
    expect(runStripTask(store([task("t1", "a"), task("t2", "b")]), "p1").id).toBe("t2");
  });

  it("covers both kinds of run, one book only, one chapter when asked", () => {
    const tasks = store([task("t1", "a", "speaker_attribution"), task("t2", "b", "speaker_identification", "p2"),
      { id: "t3", inline: true, feature: "rewrite", meta: { run: true, projectId: "p1" } }]);
    expect(runStripTask(tasks, "p1").id).toBe("t1");
    expect(runStripTask(tasks, "p1", "b")).toBeNull();
    expect(runStripTask(store([]), "p1")).toBeNull();
  });
});

describe("narrator", () => {
  it("counts narration as read lines that are not spoken, and finds the narrator", () => {
    expect(narrationOf([{ lines: 78, spoken: 35 }, { lines: 0 }, { lines: 5, spoken: 6 }])).toBe(43);
    expect(hasNarrator([{ narrator: false }, { narrator: true }])).toBe(true);
    expect(hasNarrator([])).toBe(false);
  });
});
