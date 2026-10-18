// SPDX-License-Identifier: MIT
//
// The one-click run's words on the renderer side (services/bookRun.js): each step's Status cell,
// the cost line and the price question, the banner of a run that stopped or ended, and the "what
// to check" list — on the mock's runs, which are the server's shapes (services/mock/bookRunMock.js).
import { describe, expect, test, vi } from "vitest";

vi.mock("@delebash/ui", () => ({ withAiTask: vi.fn() }));

const {
  STEP_LABELS, currentStepText, planLine, priceQuestion, priceText, reviewItems, runBanner, runningLine, stepStatusText, stepsDone,
} = await import("./bookRun.js");
const { REVIEW, mockPlan, mockRun, VII, VIII } = await import("./mock/bookRunMock.js");

const UNIT = { singular: "Chapter", plural: "Chapters" };
const step = (run, key) => run.steps.find((s) => s.key === key);

describe("a step's Status cell", () => {
  test("while it runs, its count and chapter", () => {
    const run = mockRun("running");
    expect(stepStatusText(step(run, "direction"), UNIT, run)).toBe(`Running · 1 of 2 chapters — ${VIII}`);
    expect(stepStatusText(step(run, "render"), UNIT, run)).toBe("Waiting");
    expect(currentStepText(run, UNIT)).toBe(`Direction · 1 of 2 chapters — ${VIII}`);
    expect(runningLine(run, UNIT, 784)).toBe(`Direction · 1 of 2 chapters — ${VIII} · 13:04 so far · 64,132 tokens in`);
    expect(stepsDone(run)).toBe(8);
  });

  test("once done, in each step's own words", () => {
    const run = mockRun("done");
    const said = Object.fromEntries(run.steps.map((s) => [s.key, stepStatusText(s, UNIT, run)]));
    expect(said).toEqual({
      discover: "Done · 2 chapters",
      merge: "Done · 12 people",
      add: "Done · 12 speakers added",
      analyze: "Done · 2 chapters",
      group_lines: "Done · 2 chapters",
      describe: "Done · 12 voices",
      design: "Done · 12 voices made",
      match: "Done · 1 speaker",
      direction: "Done · 2 chapters",
      render: "Done · 454 lines",
      check: "Done · 454 takes · 1 flagged",
      export: "Done",
    });
    // A chapter an earlier pass did is kept, and said so.
    expect(stepStatusText({ ...step(run, "analyze"), kept: 2 }, UNIT, run)).toBe("Done · 2 chapters · 2 already done");
    expect(stepStatusText({ key: "check", status: "skipped", note: "speech recognition is not installed" }, UNIT, run))
      .toBe("Skipped — speech recognition is not installed");
  });

  test("a run that stopped: where it stopped, and what it never reached", () => {
    const run = mockRun("failed");
    expect(stepStatusText(step(run, "export"), UNIT, run)).toBe("Stopped here");
    const stopped = mockRun("stopped");
    expect(stepStatusText(step(stopped, "check"), UNIT, stopped)).toBe("Not reached");
  });
});

describe("the price", () => {
  test("on this computer, nothing to pay", () => {
    expect(planLine(mockPlan())).toBe("Every AI step runs on this computer — nothing is sent anywhere, nothing to pay.");
  });

  test("on a cloud model, the estimate and one question", () => {
    const plan = mockPlan({ frontier: true });
    expect(plan.ask_price).toBe(true);
    expect(priceText(plan.estimate)).toBe("up to about $0.76");
    expect(planLine(plan)).toBe("Sends the book to claude-opus-5-5: about 33,404 tokens in and 31,525 out, up to about $0.76. The run asks once before it starts.");
    const q = priceQuestion(plan);
    expect(q.title).toBe("Send the book to a cloud model?");
    expect(q.confirmLabel).toBe("Make audiobook — up to about $0.76");
    expect(q.message).toContain("It asks only this once — Resume won't ask again.");
    // A model AI Settings → Pricing has no price for.
    const unknown = { ...plan, estimate: { ...plan.estimate, price: null, unpriced: ["claude-opus-5-5"] } };
    expect(priceQuestion(unknown).message).toContain("AI Settings → Pricing has no price for claude-opus-5-5, so what it costs isn't known.");
    expect(priceQuestion(unknown).confirmLabel).toBe("Make audiobook");
  });
});

describe("a run that stopped or ended", () => {
  test("its banner says where Resume picks up", () => {
    expect(runBanner(mockRun("paused"))).toEqual({
      intent: "warn",
      title: "Paused",
      text: `The app closed while this ran. Resume picks up at Direction, ${VIII}; what is done is kept.`,
    });
    expect(runBanner(mockRun("stopped")).text).toBe("Resume picks up at Render every line; what is done is kept.");
    expect(runBanner(mockRun("failed"))).toMatchObject({ intent: "danger", title: `${STEP_LABELS.export} stopped the run.` });
    expect(runBanner(mockRun("done"))).toEqual({ intent: "success", title: "Done.", text: "Made in 42:38 · 67,512 tokens in, 9,236 out." });
    expect(runBanner(mockRun("done", { frontier: true })).text).toMatch(/ · about \$\d+\.\d\d\.$/);
    expect(runBanner(mockRun("running"))).toBeNull();
  });

  test("what to check, each with where it is fixed", () => {
    const items = reviewItems(REVIEW);
    expect(items.map((i) => [i.text, i.go[0], i.link])).toEqual([
      [`${VII} — 9 lines to check in Script`, "script", "Open in Script ➜"],
      [`${VIII} — 1 line to check in Script`, "script", "Open in Script ➜"],
      [`${VII}, line 23 — its take misses words, after one new take`, "render", "Open in Render ➜"],
      [
        "12 voices made from the book — Alice, Hatter, Queen of Hearts, Dormouse, March Hare, the King, Five, the White Rabbit, Two, Seven, the Cheshire Cat, Narrator: listen to each",
        "cast",
        "Open Cast ➜",
      ],
    ]);
    expect(items[0].go[1]).toEqual({ sceneId: "sc_vii", focus: "check" });
    expect(items[2].go[1]).toEqual({ sceneId: "sc_vii" });
    expect(reviewItems({ script: [], takes: [], voices: [], uncast: [{ speaker_id: "s", name: "the Knave", lines: 1 }], refused: [] })[0].text)
      .toBe("the Knave has 1 line and no persona");
  });
});
