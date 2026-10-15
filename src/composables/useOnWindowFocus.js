// SPDX-License-Identifier: MIT
//
// Run `fn` each time the window regains focus while this page is on screen —
// no timer (decided 2026-10-15, the narrowings review R3: an open page notices
// a render started elsewhere, in another window or app, when the window
// regains focus). The app keeps its pages alive (KeepAlive): a page kept but
// not shown doesn't run it. The listener is VueUse's `useEventListener`, which
// removes it when the page goes (https://vueuse.org/core/useEventListener/).

import { useEventListener } from "@vueuse/core";
import { onActivated, onDeactivated } from "vue";

export function useOnWindowFocus(fn) {
  let shown = true;
  onActivated(() => {
    shown = true;
  });
  onDeactivated(() => {
    shown = false;
  });
  useEventListener(window, "focus", () => {
    if (shown) fn();
  });
}
