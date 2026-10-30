// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The interface language (Settings → Appearance, the kit's LanguagePicker): the ui store keeps the
// choice with the appearance (/v1/prefs `ui`) and the next start applies it — only a language
// JustVoice has a catalog for (src/i18n/locales), as the template's ui store.
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, test, vi } from "vitest";

const prefs = vi.hoisted(() => ({}));
vi.mock("../services/prefs.js", () => ({
  readPref: (key, fallback) => prefs[key] ?? fallback,
  writePref: (key, value) => {
    prefs[key] = JSON.parse(JSON.stringify(value));
  },
}));

const { useUiStore } = await import("./ui.js");
const { i18n } = await import("../i18n/index.js");

beforeEach(() => {
  for (const k of Object.keys(prefs)) delete prefs[k];
  i18n.global.locale.value = "en";
  setActivePinia(createPinia());
});

test("the language picked is kept, and the next start applies it", async () => {
  useUiStore().setLocale("en");
  await nextTick();
  expect(prefs.ui.appearance.locale).toBe("en");
  i18n.global.locale.value = "es"; // another language meanwhile (the kit has Spanish words)
  setActivePinia(createPinia());
  useUiStore();
  expect(i18n.global.locale.value).toBe("en");
});

test("a saved language JustVoice has no words for is left alone", () => {
  prefs.ui = { appearance: { locale: "fr" } };
  useUiStore();
  expect(i18n.global.locale.value).toBe("en");
});
