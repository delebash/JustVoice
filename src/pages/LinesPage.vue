<script setup>
// The Lines page (/lines): the game project's line grid (components/LinesBoard.vue) as a page of
// its own. Studio mounts the same grid inside its own page as a game project's first step, so the
// grid is a component and this file is only its page.
import { pageFlow } from "@delebash/llm-ui";
import LinesBoard from "../components/LinesBoard.vue";
</script>

<template>
  <q-page :style-fn="pageFlow">
    <LinesBoard />
  </q-page>
</template>
