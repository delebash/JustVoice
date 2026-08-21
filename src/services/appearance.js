// SPDX-License-Identifier: MIT
// JustVoice appearance — the generic theme engine + catalogs are SHARED (kit
// @delebash/llm-ui appearance). JustVoice has no manuscript editor, so no
// extraApply; it just sets its own brand defaults (Inter UI font, green accent
// hue 166 — matching tokens.css's measured palette) and re-exports the catalogs
// its Settings → Appearance UI uses. Supersedes JV's old standalone theme
// helper + SettingsView's local applyAppearance().
import {
  applyAppearance as applyGeneric,
  migrateAppearance as migrateGeneric,
  DEFAULT_APPEARANCE as GENERIC_DEFAULT,
} from "@delebash/llm-ui";

// Re-export the shared catalogs the Settings UI renders.
export {
  UI_FONTS, UI_SCALES, INK_PALETTES, ACCENT_PRESETS, GOLD_PRESETS, FUNCTIONAL_PRESETS,
  BUTTON_RADIUS_OPTIONS, BUTTON_DENSITY_OPTIONS, BUTTON_LABEL_CASE_OPTIONS, currentMode,
} from "@delebash/llm-ui";

// JustVoice defaults = the generic engine defaults + JV brand. The hue defaults
// reproduce JV's measured palette (see tokens.css) so the default look is exact.
export const DEFAULT_APPEARANCE = {
  ...GENERIC_DEFAULT,
  uiFont: "Inter",
  // Compact density — the mock's control sizing (12px btn/box scale), which
  // is the design the app is held to. Operator-changeable in Appearance.
  btnDensity: "compact",
  accentHue: 166, // green #3a7d63
  goldHue: 82,
  dangerHue: 34,
  successHue: 166,
  infoHue: 250,
  inkPalette: "auto",
  // JV-extra: i18n locale (persists now; applies once translations ship — #97).
  locale: "en",
};

export function applyAppearance(appearance) {
  applyGeneric({ ...DEFAULT_APPEARANCE, ...(appearance || {}) });
}

export function migrateAppearance(persisted = {}) {
  return migrateGeneric(persisted, DEFAULT_APPEARANCE);
}
