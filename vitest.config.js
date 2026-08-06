// SPDX-License-Identifier: MIT
// Unit-test harness (parity batch slice 11 — JW's vitest.config.js is the donor):
// default node environment; component/boot tests opt into jsdom per-file with a
// `@vitest-environment jsdom` docblock. Why this exists: build:vite compiles SFCs
// without resolving script identifiers and biome doesn't check .vue identifiers —
// a mount is the only gate that executes that code (JV's 2026-08-05 boot TDZ crash
// shipped past a fully green build+lint). Run: npm run test:unit
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // transformAssetUrls off IN TESTS ONLY: a template's `/public-asset.svg` src
  // stays a URL string (vite dev/build behavior) instead of becoming a file
  // import node can't resolve (the boot smoke hit this on the splash logo).
  plugins: [vue({ template: { transformAssetUrls: false } })],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@renderer": resolve(__dirname, "src"),
      "@delebash/llm-ui": resolve(__dirname, "../just-llm-runner/ui/src"),
    },
    // Same dedupe list as vite.config.js, same reason — keep the two in lock-step.
    dedupe: ["vue", "reka-ui", "@floating-ui/dom", "pinia", "vue-router", "vue-i18n", "marked", "vue-sonner", "@tanstack/vue-table", "@vueuse/core"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
