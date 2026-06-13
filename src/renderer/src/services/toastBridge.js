// SPDX-License-Identifier: GPL-3.0-or-later
// Bridge between callers (the ui store, anywhere) and vue-sonner's
// imperative toast() API. Unlike PrimeVue's ToastService, sonner needs no
// service-binding from a setup() context — `toast(...)` works anywhere.
// We keep this thin shim so callsites (pushToast / clearToasts) don't
// change between toast backends.
//
// Toasts carry an optional `action` ({ label, fn }) for the inline button
// that soft-delete uses to surface "Undo" — mapped to sonner's `action`
// shape ({ label, onClick }) here.

import { toast } from "vue-sonner";

// Show one toast.
//
// `kind` ("success" | "error" | "warning" | "info") routes to the matching
// vue-sonner variant so the Toaster's rich-colors give errors a red frame,
// successes green, etc. `duration` (ms) on the options object wins; the
// legacy positional `ms` arg is still honored as a fallback. Before this,
// both kind and duration were silently dropped and every toast looked the
// same — error toasts were indistinguishable from successes.
// `title` + `description` are accepted alongside `message` because ~80
// call sites across 16 views pass that shape — `if (!message) return`
// was silently swallowing every one of their toasts (wiring-audit W9,
// 2026-06-13). Sonner takes `description` natively.
export function pushToast({ message, title, description, kind, action, duration } = {}, ms) {
  const text = message ?? title;
  if (!text) return;
  const opts = {
    duration: duration ?? ms ?? 6000,
    description,
    action: action ? { label: action.label, onClick: action.fn } : undefined,
  };
  const fn =
    kind === "error"
      ? toast.error
      : kind === "success"
        ? toast.success
        : kind === "warning" || kind === "warn"
          ? toast.warning
          : kind === "info"
            ? toast.info
            : toast;
  fn(text, opts);
}

// Dismiss any visible toast (the old dismissToast cleared the single slot).
export function clearToasts() {
  toast.dismiss();
}
