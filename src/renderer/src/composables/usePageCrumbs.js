// SPDX-License-Identifier: GPL-3.0-or-later
//
// usePageCrumbs — own the topbar breadcrumb ONLY while this view is the
// active one.
//
// Why this exists (X-1, 2026-06-14): views are <KeepAlive>-cached, so a
// cached view's watchers keep running after you navigate away. A
// crumb-publishing view (Chapter/Books/Studio) watches shared-store
// data; when another view reloads that store, the cached view's watcher
// re-fires and re-publishes its stale crumb — leaking e.g. "Stillwater ›
// Chapter 1" onto the Personas page. App.vue's clear-on-nav loses that
// race.
//
// Fix: gate publishing on activation. onActivated marks the view active
// and publishes; onDeactivated marks it inactive and clears. The view's
// own watcher calls the returned `publish`, which no-ops while inactive.
// (All app views run under KeepAlive, so onActivated/onDeactivated are
// the real lifecycle here.)

import { onActivated, onDeactivated, ref } from "vue";

import { useUiContext } from "../stores/uiContext.js";

export function usePageCrumbs(buildSegments) {
  const uiContext = useUiContext();
  const active = ref(false);

  function publish() {
    if (active.value) uiContext.set(buildSegments() || []);
  }

  onActivated(() => { active.value = true; publish(); });
  onDeactivated(() => { active.value = false; uiContext.clear(); });

  return { publish };
}
