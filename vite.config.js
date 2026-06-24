import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

// Vite config mirrors JustWrite's: Vue, src/renderer as root, dist/ as output.
// The Tauri shell loads dist/ at packaged-build time; in dev it points at
// http://localhost:1430 which is what `npm run dev:vite` serves.
// Port 1430 (not 1420) is deliberate: JustWrite uses 1420, and with
// strictPort:true a collision would silently leave the Tauri window pointed
// at JustWrite's dev server. Keep these two apps on separate ports.
export default defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, "src/renderer"),
  publicDir: path.resolve(__dirname, "src/renderer/public"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer/src"),
      "@renderer": path.resolve(__dirname, "src/renderer/src"),
      // Shared LLM UI package — aliased to its src for the dev/HMR loop.
      "@delebash/llm-ui": path.resolve(__dirname, "../just-llm-runner/ui/src"),
    },
    // The aliased kit imports peer deps (vue, reka-ui, marked) by bare
    // specifier from its own dir; dedupe forces a SINGLE copy resolved from
    // this app's node_modules (Reka's provide/inject context + Vue reactivity
    // break with two instances). reka-ui is what UiSelect needs; marked is what
    // the shared HelpDrawer's helpMarkdown renderer needs.
    dedupe: ["vue", "reka-ui", "@floating-ui/dom", "pinia", "vue-router", "vue-i18n", "marked", "vue-sonner"],
  },
  server: {
    host: "127.0.0.1",
    port: 1430,
    strictPort: true,
    // Tauri picks up HMR changes via the dev server.
    hmr: { port: 1431 },
    // Allow serving the aliased shared @delebash/llm-ui package (sibling repo).
    fs: { allow: [path.resolve(__dirname, "src/renderer"), path.resolve(__dirname, "../just-llm-runner/ui")] },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "esnext",
    sourcemap: true,
  },
});
