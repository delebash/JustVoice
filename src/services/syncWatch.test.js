/** @vitest-environment jsdom */
// SPDX-License-Identifier: MIT
// The kit's sync watcher with `waitWhileEditing` (P18, decided 2026-10-15): another device's
// changes reload the window, but not while a dialog is open or the cursor is in a text box.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rev = { value: 1 };
vi.mock("@delebash/llm-ui/common/services/serverApi.js", () => ({
  get: vi.fn(async () => ({ rev: rev.value, pollSeconds: 5 })),
}));

const { isEditing, watchSync } = await import("@delebash/llm-ui/common/services/syncWatch.js");

describe("isEditing", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is false with nothing open and no text box focused", () => {
    expect(isEditing()).toBe(false);
  });

  it("is true while a Quasar dialog is in the page", () => {
    document.body.innerHTML = '<div class="q-dialog"></div>';
    expect(isEditing()).toBe(true);
  });

  it("is true with the cursor in a text input, a textarea or an editable element", () => {
    document.body.innerHTML = '<input id="a" type="text"><textarea id="b"></textarea><div id="c" contenteditable="true"></div>';
    for (const id of ["a", "b"]) {
      document.getElementById(id).focus();
      expect(isEditing()).toBe(true);
    }
    const c = document.getElementById("c");
    Object.defineProperty(c, "isContentEditable", { value: true }); // jsdom doesn't compute it
    c.focus();
    expect(isEditing()).toBe(true);
  });

  it("is false with a checkbox or a button focused", () => {
    document.body.innerHTML = '<input id="a" type="checkbox"><button id="b">x</button>';
    for (const id of ["a", "b"]) {
      document.getElementById(id).focus();
      expect(isEditing()).toBe(false);
    }
  });
});

describe("watchSync waitWhileEditing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rev.value = 1;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("holds a change while a dialog is open, then runs it at the first check after", async () => {
    const onChange = vi.fn();
    const stop = watchSync(onChange, { waitWhileEditing: true });
    await vi.advanceTimersByTimeAsync(0); // first check: rev 1 noted
    document.body.innerHTML = '<div class="q-dialog"></div>';
    rev.value = 2;
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("without the option, runs the change at once", async () => {
    const onChange = vi.fn();
    const stop = watchSync(onChange);
    await vi.advanceTimersByTimeAsync(0);
    document.body.innerHTML = '<div class="q-dialog"></div>';
    rev.value = 2;
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });
});
