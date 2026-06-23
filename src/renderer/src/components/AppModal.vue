<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  AppModal — generic modal wrapper used by ~11 callsites. Same API
  surface (eyebrow / title / wide / noPadding / closable + default /
  header / footer slots) the codebase already calls. Reka UI's Dialog
  provides focus trap + Esc + scroll lock + ARIA; JustVoice styles
  do the rest via .jv-overlay / .jv-modal classes in justvoice.css.
-->
<script setup>
import { ref, useSlots, watch } from "vue";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
  VisuallyHidden,
} from "reka-ui";
import { Icon } from "@delebash/llm-ui";

const props = defineProps({
  eyebrow:   { type: String, default: "" },
  title:     { type: String, default: "" },
  wide:      { type: Boolean, default: false },
  noPadding: { type: Boolean, default: false },
  closable:  { type: Boolean, default: true },
});
const emit = defineEmits(["close"]);

const slots = useSlots();
const TRANSITION_MS = 200;
const visible = ref(true);
let pending = null;
watch(visible, (v, prev) => {
  if (!v && prev) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => { pending = null; emit("close"); }, TRANSITION_MS);
  }
});
function close() { visible.value = false; }
defineExpose({ close });

function onEscape(e) { if (!props.closable) e.preventDefault(); }
function onOutside(e) { e.preventDefault(); }
</script>

<template>
  <DialogRoot v-model:open="visible">
    <DialogPortal>
      <DialogOverlay class="jv-overlay" />
      <DialogContent
        class="jv-modal"
        :class="{ 'jv-modal--wide': wide, 'jv-modal--flush': noPadding }"
        @escape-key-down="onEscape"
        @pointer-down-outside="onOutside"
        @interact-outside="onOutside"
      >
        <header class="jv-modal__header">
          <slot name="header">
            <DialogTitle as-child>
              <div class="jv-modal__titleblock">
                <div v-if="eyebrow" class="jv-modal__eyebrow">{{ eyebrow }}</div>
                <div v-if="title" class="jv-modal__title">{{ title }}</div>
              </div>
            </DialogTitle>
          </slot>
          <VisuallyHidden v-if="slots.header" as-child>
            <DialogTitle>{{ title || "Dialog" }}</DialogTitle>
          </VisuallyHidden>
          <DialogClose
            v-if="closable"
            class="jv-modal__close"
            aria-label="Close"
          >
            <Icon name="Close" :size="14" />
          </DialogClose>
        </header>

        <div class="jv-modal__body">
          <slot />
        </div>

        <footer v-if="slots.footer" class="jv-modal__footer">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
