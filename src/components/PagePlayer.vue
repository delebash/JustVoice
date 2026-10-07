<!-- SPDX-License-Identifier: MIT -->
<!--
  The page's one <audio>, bound to a usePagePlayer(). Hidden on purpose: its
  controls (PlayTransport.vue) show in the row whose ▶ started it.
-->
<script setup>
defineProps({ player: { type: Object, required: true } });
</script>

<template>
  <audio :ref="(el) => (player.el = el)" :src="player.src || undefined" class="jv-player-el"
    @timeupdate="player.onTime()" @loadedmetadata="player.onTime()"
    @play="player.paused = false" @pause="player.paused = true" @ended="player.onEnded()" />
</template>
