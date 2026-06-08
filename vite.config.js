import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

// Vite config mirrors JustWrite's: Vue, src/renderer as root, dist/ as output.
// The Tauri shell loads dist/ at packaged-build time; in dev it points at
// http://localhost:1420 which is what `npm run dev:vite` serves.
export default defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, "src/renderer"),
  publicDir: path.resolve(__dirname, "src/renderer/public"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer/src"),
      "@renderer": path.resolve(__dirname, "src/renderer/src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    // Tauri picks up HMR changes via the dev server.
    hmr: { port: 1421 },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "esnext",
    sourcemap: true,
  },
});
