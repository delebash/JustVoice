// SPDX-License-Identifier: MIT
//
// useKeptScroll — a <KeepAlive>-cached page comes back scrolled where you
// left it.
//
// Why this exists (2026-09-29, "navigating in a spa shouldnt reset the state
// unless we tell it to"): keeping a page alive keeps its state, but the page
// scrolls inside the app's shared content area, which every other page scrolls
// too — so on return the content area is wherever the last page left it. This
// records the scroller's position while the page is on screen, and puts it
// back when the page is shown again.
//
// The position is recorded on each scroll rather than read on the way out: by
// the time `onDeactivated` runs, the page's DOM is already detached and has no
// scroller to read.

import { nextTick, onActivated, onDeactivated } from "vue";

function scrollerOf(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n;
  }
  return null;
}

/** `rootRef` is a ref to the page's root element. */
export function useKeptScroll(rootRef) {
  let top = 0;
  let scroller = null;
  const record = () => { top = scroller?.scrollTop || 0; };

  onActivated(() => {
    nextTick(() => {
      scroller = scrollerOf(rootRef.value);
      if (!scroller) return;
      scroller.scrollTop = top;
      scroller.addEventListener("scroll", record, { passive: true });
    });
  });
  onDeactivated(() => {
    scroller?.removeEventListener("scroll", record);
    scroller = null;
  });
}
