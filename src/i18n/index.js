// SPDX-License-Identifier: MIT
//
// i18n scaffold (Phase 9 / Slice 1 — plan task #97).
//
// Wires vue-i18n with en.json. Future locales (ja / es / fr / de) land
// as sibling JSON files in ./locales/ and get registered in the
// `messages` map below. Settings → Appearance gains a locale picker in
// a follow-on slice.
//
// This is INTENTIONALLY MINIMAL — only a small handful of strings are
// extracted into en.json yet. The full string-sweep across views +
// components is a dedicated future phase when there's a translation
// budget to actually use the catalog. Until then existing string
// literals in views keep working; new strings can opt-in to
// `t('key')` lookups as they're written.

import { createI18n } from "vue-i18n";

import en from "./locales/en.json";

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: { en },
});
