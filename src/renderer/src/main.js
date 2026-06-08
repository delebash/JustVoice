import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { tooltipDirective } from "./services/tooltip.js";
import { bootStorage } from "./services/storage.js";
import "./styles.css";

async function boot() {
  // Hydrate persistent UI state from IDB BEFORE Pinia stores read from it.
  // bootStorage() is idempotent — safe to call multiple times.
  await bootStorage();

  const app = createApp(App);
  app.use(createPinia());
  app.directive("tooltip", tooltipDirective);
  app.mount("#app");
}

boot();
