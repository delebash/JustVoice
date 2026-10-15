// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// An open page notices a render started elsewhere when the window regains
// focus, no timer (2026-10-15, the narrowings review R3) — while it is on
// screen: the app keeps its pages alive, and a kept page that isn't shown waits.
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import { expect, test, vi } from "vitest";
import { useOnWindowFocus } from "./useOnWindowFocus.js";

test("runs on focus while the page is shown, not while it is kept but hidden, and goes with it", async () => {
  const fn = vi.fn();
  const Page = defineComponent({
    setup() {
      useOnWindowFocus(fn);
      return () => h("div");
    },
  });
  const Other = defineComponent({ render: () => h("span") });
  const shown = ref(true);
  const app = createApp({ render: () => h(KeepAlive, null, { default: () => (shown.value ? h(Page) : h(Other)) }) });
  const el = document.createElement("div");
  document.body.appendChild(el);
  app.mount(el);
  const focus = () => window.dispatchEvent(new Event("focus"));

  focus();
  expect(fn).toHaveBeenCalledTimes(1);
  shown.value = false;
  await nextTick();
  focus();
  expect(fn).toHaveBeenCalledTimes(1);
  shown.value = true;
  await nextTick();
  focus();
  expect(fn).toHaveBeenCalledTimes(2);
  app.unmount();
  el.remove();
  focus();
  expect(fn).toHaveBeenCalledTimes(2);
});
