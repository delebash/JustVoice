import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

// Vite config mirrors JustWrite's: Vue, the repo root as the vite root, dist/
// as output. The Tauri shell loads dist/ at packaged-build time; in dev it
// points at http://localhost:1430 which is what `npm run dev:vite` serves.
// Port 1430 (not 1420) is deliberate: JustWrite uses 1420, and with
// strictPort:true a collision would silently leave the Tauri window pointed
// at JustWrite's dev server. Keep these two apps on separate ports.
//
// Layout (what create-tauri-app produces):
//   index.html      ← vite root
//   src/main.js     ← Vue entry
//   public/         ← copied verbatim
//   dist/           ← build output, Tauri's `frontendDist`
//   src-tauri/      ← Rust crate
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // The family renderer alias — `@renderer` only (the extra `@` died in
      // target-tree P10 with ZERO imports using it; one name family-wide).
      "@renderer": path.resolve(__dirname, "src"),
      // Shared LLM UI package — aliased to its src for the dev/HMR loop.
      "@delebash/llm-ui": path.resolve(__dirname, "../just-llm-runner/ui/src"),
    },
    // The aliased kit imports peer deps (vue, reka-ui, marked, @tanstack/vue-table)
    // by bare specifier from its own dir; dedupe forces a SINGLE copy resolved from
    // this app's node_modules (Reka's provide/inject context + Vue reactivity
    // break with two instances). reka-ui is what UiSelect needs; marked is what
    // the shared HelpDrawer's helpMarkdown renderer needs; @tanstack/vue-table is
    // what UiTable needs (JV's library tables will converge to UiTable).
    // @vueuse/core rides the kit AppModal's header-drag (useDraggable) — declared a
    // real dep + deduped 2026-08-05 (s2 audit: the kit imported it while JV never
    // declared it; it resolved by hoisting luck only).
    dedupe: ["vue", "reka-ui", "@floating-ui/dom", "pinia", "vue-router", "vue-i18n", "marked", "vue-sonner", "@tanstack/vue-table", "@vueuse/core"],
  },
  server: {
    host: "127.0.0.1",
    port: 1430,
    strictPort: true,
    // Tauri picks up HMR changes via the dev server.
    hmr: { port: 1431 },
    // Same shape create-tauri-app ships, extended for what THIS repo keeps beside the
    // frontend. A scaffolded app names only src-tauri because src-tauri is all it has
    // there; the vite root is the repo, so everything else lands in the watcher's path
    // too. Measured off chokidar's own getWatched(): 381 files guarded, 30,881
    // unguarded (server 17,865 — the engines' venvs — and src-tauri 12,510), and the
    // first HTML request went 500 ms -> 6,191 ms. vite ignores node_modules and .git
    // itself, so neither belongs here.
    watch: {
      ignored: ["**/src-tauri/**", "**/server/**", "**/dist/**", "**/preview/**", "**/legacy-gui/**"],
    },
    // The dev server refuses to read outside its root. The repo root now covers docs/
    // (the in-app Help viewer globs docs/*.md) and the app itself; the sibling kit is
    // a genuine outsider, consumed from source for HMR.
    fs: { allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "../just-llm-runner/ui")] },
  },
  build: {
    // JW's build shape (target-tree P10). Tauri's bundled webview is a current
    // Chromium / WKWebView on each OS; the per-platform targets keep esbuild
    // from down-leveling (the old `esnext` + always-on sourcemap died here).
    // The macOS floor (safari17) matches the WKWebView version Tauri 2 ships
    // against.
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari17",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
