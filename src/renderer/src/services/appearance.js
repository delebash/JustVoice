// SPDX-License-Identifier: GPL-3.0-or-later
// Theming — applies the active colour theme to the document at runtime by
// setting the [data-theme] attribute the design tokens key off (tokens.css).
// App standard: theming lives in a dedicated services/appearance.js, not inlined
// in a store.

export function resolveTheme(theme) {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme) {
  if (typeof document === "undefined") return;
  // tokens.css overrides live under [data-theme="dark"]; "light" falls through to
  // the :root defaults. (Previously this toggled a `.dark` CLASS, which the
  // tokens never matched — dark mode silently did nothing.)
  document.documentElement.setAttribute("data-theme", resolveTheme(theme));
}

// Re-apply when the OS preference flips, but only while following "system".
// `isSystem` is read live so the caller keeps control of the mode. Returns a
// teardown fn.
export function watchSystemTheme(isSystem) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (isSystem()) applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
