// SPDX-License-Identifier: MIT
// SynthScheduler policy tests — engine-major drain, FIFO fairness, free-riding, interactive
// priority, abort-on-first-error, cancel (the port of tests/test_synth_scheduler.py).
//
// Each test builds its own SynthScheduler (never the process singleton) and holds the worker
// on a gate item so submissions queue deterministically before the drain starts. (Python's
// threading.Event is the kit's AsyncEvent; a wait's timeout is in milliseconds there.)
import { AsyncEvent, sleep } from "@delebash/llm-runner/platform/asyncutil";
import { beforeEach, expect, test, vi } from "vitest";
import * as manager from "../src/engines/manager.js";
import { SynthScheduler, warmSpecs } from "../src/synth_scheduler.js";

// The worker's idle transition re-probes the resident engine's memory; nothing is resident.
beforeEach(() => {
  vi.spyOn(manager, "getManager").mockReturnValue({ bumpEngineReservation: async () => {} });
});

/** Occupy the worker with a first item until the returned gate is set. */
async function gated(sched) {
  const gate = new AsyncEvent();
  const started = new AsyncEvent();
  sched.submit([
    [
      "gate-engine",
      async () => {
        started.set();
        await gate.wait(5000);
      },
    ],
  ]);
  expect(await started.wait(5000)).toBe(true);
  return gate;
}

test("engine_major_within_one_set", async () => {
  const sched = new SynthScheduler();
  const gate = await gated(sched);
  const seq = [];
  const handle = sched.submit([
    ["A", () => seq.push("A1")],
    ["B", () => seq.push("B1")],
    ["A", () => seq.push("A2")],
    ["B", () => seq.push("B2")],
  ]);
  gate.set();
  expect(await handle.wait(5)).toBe(true);
  expect(seq).toEqual(["A1", "A2", "B1", "B2"]);
});

test("oldest_pending_line_names_the_next_engine", async () => {
  const sched = new SynthScheduler();
  const gate = await gated(sched);
  const seq = [];
  const h1 = sched.submit([["B", () => seq.push("B-first")]]);
  const h2 = sched.submit([["A", () => seq.push("A-second")]]);
  gate.set();
  expect((await h1.wait(5)) && (await h2.wait(5))).toBe(true);
  expect(seq).toEqual(["B-first", "A-second"]);
});

test("newer_sets_free_ride_the_loaded_engine", async () => {
  const sched = new SynthScheduler();
  const gate = await gated(sched);
  const seq = [];
  const h1 = sched.submit([
    ["A", () => seq.push("A-set1")],
    ["B", () => seq.push("B-set1")],
  ]);
  const h2 = sched.submit([["A", () => seq.push("A-set2")]]);
  gate.set();
  expect((await h1.wait(5)) && (await h2.wait(5))).toBe(true);
  // Set 2's A line rides along while A is current; B waits.
  expect(seq).toEqual(["A-set1", "A-set2", "B-set1"]);
});

test("interactive_jumps_at_the_line_boundary", async () => {
  const sched = new SynthScheduler();
  const gate = await gated(sched);
  const seq = [];
  const batch = sched.submit([
    ["A", () => seq.push("A1")],
    ["A", () => seq.push("A2")],
  ]);
  const single = sched.submit([["B", () => seq.push("B!")]], { interactive: true });
  gate.set();
  expect((await batch.wait(5)) && (await single.wait(5))).toBe(true);
  expect(seq[0]).toBe("B!");
  expect(seq.slice(1)).toEqual(["A1", "A2"]);
});

test("first_failure_withdraws_the_rest_of_the_set", async () => {
  const sched = new SynthScheduler();
  const seq = [];
  const boom = () => {
    throw new RangeError("synth exploded");
  };
  const handle = sched.submit([
    ["A", () => seq.push("ok")],
    ["A", boom],
    ["A", () => seq.push("never")],
  ]);
  expect(await handle.wait(5)).toBe(true);
  expect(seq).toEqual(["ok"]);
  expect(handle.error).toBeInstanceOf(RangeError);
  expect(() => handle.raiseIfFailed()).toThrow(RangeError);
});

test("cancel_withdraws_pending_items", async () => {
  const sched = new SynthScheduler();
  const gate = await gated(sched);
  const seq = [];
  const handle = sched.submit([
    ["A", () => seq.push("x")],
    ["A", () => seq.push("y")],
  ]);
  sched.cancel(handle.setId);
  gate.set();
  expect(await handle.wait(5)).toBe(true);
  expect(handle.cancelled).toBe(true);
  expect(handle.error).toBeNull();
  await sleep(50);
  expect(seq).toEqual([]);
});

test("single_item_result_round_trips", async () => {
  const sched = new SynthScheduler();
  const handle = sched.submit([["A", () => 42]], { interactive: true });
  expect(await handle.wait(5)).toBe(true);
  handle.raiseIfFailed();
  expect(handle.items[0].result).toBe(42);
});

test("empty_set_completes_immediately", () => {
  const sched = new SynthScheduler();
  const handle = sched.submit([]);
  expect(handle.done.isSet()).toBe(true);
});

test("warm_specs_swallows_failures", async () => {
  const boom = () => {
    throw new Error("no engine");
  };
  // Must not throw — warm sets are advisory; the render loop is the error surface (§7d of the
  // 2026-08-08 plan).
  await warmSpecs([["A", boom]]);
});

// ── what is ahead (decided 2026-10-07: Render says what a waiting render waits for) ──

const CH2 = { label: "2 · Bigger Inside", kind: "chapter" };
const M4B = { label: "the M4B export", kind: "work" };
const times = (n, spec) => Array.from({ length: n }, () => spec);

test("ahead_names_the_work_before_a_set_in_the_order_it_runs", async () => {
  const sched = new SynthScheduler();
  const gate = await gated(sched);
  sched.submit(times(3, ["B", () => null]), { owner: CH2 });
  sched.submit(times(2, ["A", () => null]), { owner: M4B });
  const mine = sched.submit([["A", () => null]]);
  expect(sched.ahead([mine.setId])).toEqual({
    lines: 6,
    groups: [
      { label: "other work", kind: "work", engine: "gate-engine", lines: 1 },
      { label: "2 · Bigger Inside", kind: "chapter", engine: "B", lines: 3 },
      { label: "the M4B export", kind: "work", engine: "A", lines: 2 },
    ],
  });
  gate.set();
  expect(await mine.wait(5)).toBe(true);
  expect(sched.ahead([mine.setId])).toBeNull();
});

test("ahead_follows_the_loaded_model_first", async () => {
  // A newer set on the model that is loaded goes before an older one on another model — so
  // only the line running is ahead of it.
  const sched = new SynthScheduler();
  const gate = new AsyncEvent();
  const started = new AsyncEvent();
  sched.submit(
    [
      [
        "A",
        async () => {
          started.set();
          await gate.wait(5000);
        },
      ],
    ],
    { owner: M4B },
  );
  expect(await started.wait(5000)).toBe(true);
  sched.submit(times(4, ["B", () => null]), { owner: CH2 });
  const mine = sched.submit([["A", () => null]]);
  expect(sched.ahead([mine.setId])).toEqual({
    lines: 1,
    groups: [{ label: "the M4B export", kind: "work", engine: "A", lines: 1 }],
  });
  gate.set();
  expect(await mine.wait(5)).toBe(true);
});

test("ahead_is_none_while_the_sets_own_line_runs", async () => {
  const sched = new SynthScheduler();
  const gate = new AsyncEvent();
  const started = new AsyncEvent();
  const mine = sched.submit(
    [
      [
        "A",
        async () => {
          started.set();
          await gate.wait(5000);
        },
      ],
      ["A", () => null],
    ],
    { owner: CH2 },
  );
  expect(await started.wait(5000)).toBe(true);
  expect(sched.ahead([mine.setId])).toBeNull();
  gate.set();
  expect(await mine.wait(5)).toBe(true);
});
