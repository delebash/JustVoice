<!-- SPDX-License-Identifier: MIT -->
<script setup>
// The root component Quasar mounts — a bare <router-view>, as Quasar's CLI creates it
// (app-structure §Q.1): the routes decide what shows (router/routes.js) — the app in its layout
// (layouts/MainLayout.vue), the floating dictation pill (/dictate, for ?view=dictate), or the
// connection-error page when the server didn't answer at start-up (boot/jv.js sends it there).
import { onMounted } from "vue";

// index.html's static boot plate covers the window until Vue renders; the layout's own splash
// takes over from here.
onMounted(() => document.getElementById("app-boot")?.remove());
</script>

<template>
  <router-view />
</template>
