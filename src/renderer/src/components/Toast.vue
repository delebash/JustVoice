<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Toast host — mounts once in App.vue. vue-sonner positions toasts in a
  portal and handles stacking/timing. JustVoice styling via .jv-toaster.
-->
<script setup>
import { Toaster } from "vue-sonner";
</script>

<template>
  <Toaster
    position="bottom-center"
    :duration="6000"
    :gap="10"
    :visible-toasts="3"
    :offset="40"
    close-button
    rich-colors
    class="jv-toaster"
  />
</template>
