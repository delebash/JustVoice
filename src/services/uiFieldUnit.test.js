// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The kit's UiField keeps a label's trailing "(unit)" out of the uppercase eyebrow: Settings'
// "Head silence (s)" read "HEAD SILENCE (S)" (2026-10-15, the P26 sweep).
import { createApp, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import UiField from "@delebash/llm-ui/common/components/UiField.vue";

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});

function mount(props) {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createApp({ render: () => h(UiField, props) });
  app.mount(el);
  return el;
}

describe("UiField's unit", () => {
  it("wraps a trailing (unit) in .ui-unit", () => {
    const root = mount({ label: "Head silence (s)", layout: "block" });
    const unit = root.querySelector("label .ui-unit");
    expect(unit?.textContent.trim()).toBe("(s)");
    expect(root.querySelector("label").textContent).toBe("Head silence (s)");
  });

  it("leaves a label with no trailing (…) as it is", () => {
    const root = mount({ label: "Name", layout: "block" });
    expect(root.querySelector("label .ui-unit")).toBeNull();
    expect(root.querySelector("label").textContent).toBe("Name");
  });
});
