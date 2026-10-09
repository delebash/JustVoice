// SPDX-License-Identifier: MIT
// Vue Router — hash history (the desktop window's app:// pages have no server for real paths),
// lazy-loaded view components (app standard). ONE router instance: Quasar installs it (the
// default export, app-structure §Q.1) and modules that navigate imperatively import it.
import { defineRouter } from "#q-app";
import { createRouter, createWebHashHistory } from "vue-router";
import routes from "./routes.js";

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default defineRouter(() => router);
