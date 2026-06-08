import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { installTooltip } from "./services/tooltip.js";
import { bootStorage } from "./services/storage.js";
import "./styles.css";

async function boot() {
  // Hydrate persistent UI state from IDB BEFORE Pinia stores read from it.
  // bootStorage() is idempotent — safe to call multiple times.
  await bootStorage();

  const app = createApp(App);
  app.use(createPinia());
  installTooltip(app);
  app.mount("#app");
}

boot();
