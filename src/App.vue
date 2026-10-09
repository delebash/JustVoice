<!-- SPDX-License-Identifier: MIT -->
<script setup>
// The root component Quasar mounts (app-structure §Q.1): the app's shell (AppShell.vue), the
// floating dictation pill (?view=dictate), or — when the server didn't answer at start-up — the
// kit's connection-error screen in its place. The boot file decides (boot/jv.js sets
// services/bootState.js). Before the Quasar move, main.js mounted one of the three as its own app.
import { onMounted } from "vue";
import { ConnectionError, serverUrl } from "@delebash/llm-ui";
import AppShell from "./AppShell.vue";
import DictateWindow from "./components/DictateWindow.vue";
import { bootView } from "./services/bootState.js";

// index.html's static boot plate covers the window until Vue renders; the shell's own splash
// takes over from here.
onMounted(() => document.getElementById("app-boot")?.remove());
</script>

<template>
  <DictateWindow v-if="bootView === 'dictate'" />
  <ConnectionError
    v-else-if="bootView === 'server-down'"
    app-name="JustVoice"
    :server-url="serverUrl('')"
    need="load voices, projects, and settings"
    dev-hint="Dev: it should start automatically with `npm run dev`, or run it yourself with `npm run server`, then retry."
  />
  <AppShell v-else />
</template>
