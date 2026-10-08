import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

// Vite builds the renderer only (JustWrite's shape). The desktop app is Electron (the
// family's move, 2026-10-08): `electron/main.js` runs the kit's shell, and the server is
// `server/src/serve.js`. In dev the window points at http://127.0.0.1:1430, which is what
// `npm run dev:vite` serves. Port 1430 (not 1420) is deliberate: JustWrite uses 1420, and
// with strictPort:true a collision would silently leave the window pointed at JustWrite's
// dev server. Keep these two apps on separate ports.
//
// Layout:
//   index.html      ← vite root
//   src/main.js     ← Vue entry
//   public/         ← copied verbatim
//   dist/           ← vite build output — the window loads it from app://, the headless
//                     server serves it at /ui/
//   electron/       ← the desktop app (the kit's runDesktopApp)
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
    // The window picks up HMR changes via the dev server.
    hmr: { port: 1431 },
    // The vite root is the repo, so everything beside the frontend lands in the watcher's
    // path too. Measured off chokidar's own getWatched() (2026-08): 381 files guarded,
    // 30,881 unguarded, and the first HTML request went 500 ms -> 6,191 ms. data/ is the
    // dev data folder (models and caches). vite ignores node_modules and .git itself, so
    // neither belongs here.
    watch: {
      ignored: ["**/server/**", "**/data/**", "**/dist/**", "**/release/**", "**/preview/**", "**/legacy-gui/**"],
    },
    // The dev server refuses to read outside its root. The repo root now covers docs/
    // (the in-app Help viewer globs docs/*.md) and the app itself; the sibling kit is
    // a genuine outsider, consumed from source for HMR.
    fs: { allow: [path.resolve(__dirname, "."), path.resolve(__dirname, "../just-llm-runner/ui")] },
  },
  build: {
    // JW's build shape. The desktop window is Electron's own Chromium (152 in Electron 44)
    // on every OS, so one modern target keeps the bundler from down-leveling; the headless
    // UI is opened in a current browser. minify is a BOOLEAN on purpose (P10).
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "chrome140",
    minify: true,
  },
});
