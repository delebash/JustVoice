<!-- SPDX-License-Identifier: MIT -->
<!--
  StoriesView — placeholder for the multi-track timeline editor.

  GATED 2026-06-13 (wiring-audit W3, user decision: option a). The
  previous timeline mock called GET/POST /v1/stories — endpoints that
  have never existed server-side — so every visit error-toasted and
  every affordance was dead. Rather than bolt a throwaway CRUD onto
  story_items, the surface states the truth until the Timeline plan
  (the known biggest parity gap, needs its own plan) builds the real
  thing. The mock layout lives in git history for that plan to mine.

  Precedent (RULE #1): the no-engine lede card — jv-card + muted lede +
  link to where the work happens today (b566602).
-->
<script setup>
// Intentionally inert: no API calls until /v1/stories exists.
</script>

<template>
  <div class="stories jv-fill">
    <div class="jv-card stories__coming">
      <h2 class="stories__coming-title">Timeline</h2>
      <p>
        The multi-track timeline editor — arranging rendered clips across
        tracks for episode assembly and multi-voice mixing — isn't built
        yet. It's planned as its own feature, and this page will become it.
      </p>
      <p class="jv-muted">
        Until then, your imported episodes and their segments live in
        <a href="#chapter">Episodes</a>, and rendering happens in
        <a href="#studio">Studio</a>.
      </p>
    </div>
  </div>
</template>

<style scoped>
.stories { padding: 32px; }
.stories__coming { max-width: var(--shell-form); padding: 28px 32px; }
.stories__coming-title { margin: 0 0 10px; }
.stories__coming p { margin: 0 0 10px; max-width: 60ch; }
</style>
