// SPDX-License-Identifier: MIT
//
// vue-i18n — the instance the i18n boot file installs (boot/i18n.js), here so services and stores
// translate too.
//
// The kit's words come first: the instance starts from the kit's catalogs (`kit.*`) and
// JustVoice's own are merged over them, so a `kit.*` key in ./locales/en.json rewords the kit's —
// "LLM providers" for the AI console's tab (the vue-i18n standard; the family's plan,
// just-core/docs/plans/2026-10-12-i18n-standard.md, Task 1 step B). A language is a file in
// ./locales/ (`<code>.json`, the kit's one rule in catalogsFromFiles).
//
// Most of JustVoice's screens still carry their words in their templates; moving them into
// ./locales/en.json is the plan's Task 5.

import { createI18n } from "vue-i18n";
import { catalogsFromFiles, kitMessages } from "@delebash/ui/i18n/index.js";

const own = catalogsFromFiles(import.meta.glob("./locales/*.json", { eager: true }));

// kitMessages() with the call: vue-i18n merges into the objects it is given, so the kit's catalog
// must be a fresh copy.
export const i18n = createI18n({ legacy: false, locale: "en", fallbackLocale: "en", messages: kitMessages() });
for (const [code, msgs] of Object.entries(own)) i18n.global.mergeLocaleMessage(code, msgs);
