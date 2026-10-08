// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The capture pill's error state is a button (ruling 8 of the 2026-10-08
// clean-room rewrite): Enter and Space press it like a click — the error goes
// to the clipboard and the pill is dismissed. Outside the error state the keys
// are left alone, so the stop button inside the recording pill keeps its own.
import { createApp, h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@delebash/llm-ui", () => ({
  Icon: { props: ["name", "size", "fill"], setup: () => () => h("i") },
  UiButton: {
    props: ["intent", "size"],
    emits: ["click"],
    setup: (_p, { slots, emit }) => () => h("button", { onClick: (e) => emit("click", e) }, slots.icon?.()),
  },
}));

const { default: CapturePill } = await import("./CapturePill.vue");

let app;
let el;
const writeText = vi.fn(() => Promise.resolve());

afterEach(() => {
  app?.unmount();
  el?.remove();
  writeText.mockClear();
});

async function mount(props) {
  const dismiss = vi.fn();
  const stop = vi.fn();
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createApp({ render: () => h(CapturePill, { ...props, onDismiss: dismiss, onStop: stop }) });
  app.mount(el);
  await nextTick();
  return { pill: el.querySelector(".capture-pill"), dismiss, stop };
}

const press = (target, key) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const settle = () => new Promise((r) => setTimeout(r, 0));

test("enter_and_space_press_the_error_pill", async () => {
  for (const key of ["Enter", " "]) {
    const { pill, dismiss } = await mount({ state: "error", errorMessage: "The recognizer is not installed" });
    expect(pill.getAttribute("role")).toBe("button");
    expect(pill.getAttribute("tabindex")).toBe("0");
    const event = press(pill, key);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith("The recognizer is not installed");
    expect(dismiss).toHaveBeenCalledOnce();
    app.unmount();
    el.remove();
    app = null;
    writeText.mockClear();
  }
});

test("a_click_does_the_same", async () => {
  const { pill, dismiss } = await mount({ state: "error", errorMessage: "boom" });
  pill.click();
  await settle();
  expect(writeText).toHaveBeenCalledWith("boom");
  expect(dismiss).toHaveBeenCalledOnce();
});

test("an_error_with_no_message_does_nothing", async () => {
  const { pill, dismiss } = await mount({ state: "error", errorMessage: "" });
  expect(pill.textContent).toContain("Error");
  press(pill, "Enter");
  await settle();
  expect(writeText).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
});

test("other_states_leave_the_keys_alone", async () => {
  const { pill, dismiss, stop } = await mount({ state: "recording", elapsedMs: 65_400 });
  expect(pill.textContent).toContain("1:05");
  const stopButton = pill.querySelector("button");
  const event = press(stopButton, "Enter");
  await settle();
  expect(event.defaultPrevented).toBe(false); // the button's own Enter still works
  expect(dismiss).not.toHaveBeenCalled();
  stopButton.click();
  expect(stop).toHaveBeenCalledOnce();
  expect(dismiss).not.toHaveBeenCalled();
});
