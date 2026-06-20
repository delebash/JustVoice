<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  AppDialog — singleton dialog host for promptDialog() / confirmDialog()
  (services/dialog.js). Mounted once at the top of App.vue.

  Built on Reka UI's headless Dialog primitives for a11y (focus trap,
  Esc, ARIA) and visually styled with the JustVoice .jv-* CSS layer.
-->
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { dialogState, _resolveDialog } from "../services/dialog.js";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "reka-ui";
import Icon from "./Icon.vue";
import JvButton from "./ui/JvButton.vue";
import JvInput from "./ui/JvInput.vue";
import JvSelect from "./ui/JvSelect.vue";
import JvTextarea from "./ui/JvTextarea.vue";

// Normalize the active dialog into a single shape the template reads.
// Single-field prompts become a one-element `fields` list so the template
// handles one case only.
const dialog = computed(() => {
  if (!dialogState.kind) return null;
  const opts = dialogState.options || {};
  if (dialogState.kind === "confirm") {
    return {
      kind: "confirm",
      title: opts.title || "Confirm",
      message: opts.message || "",
      confirmLabel: opts.confirmLabel || "Confirm",
      cancelLabel: opts.cancelLabel || "Cancel",
      danger: !!opts.danger,
    };
  }
  const fields = Array.isArray(opts.fields) && opts.fields.length
    ? opts.fields
    : [{
        key: "value",
        label: opts.label || "",
        placeholder: opts.placeholder || "",
        defaultValue: opts.defaultValue ?? "",
        type: opts.type || "text",
        options: opts.options,
      }];
  return {
    kind: "prompt",
    title: opts.title || "",
    message: opts.message || "",
    confirmLabel: opts.confirmLabel || "OK",
    cancelLabel: opts.cancelLabel || "Cancel",
    danger: !!opts.danger,
    fields,
    isSingle: !Array.isArray(opts.fields),
    requireMatch: opts.requireMatch || null,
  };
});

const visible = computed({
  get: () => dialogState.open,
  set: (v) => { if (!v) cancel(); },
});

const values = ref({});
const firstInput = ref(null);

watch(
  () => dialogState.open,
  async (open) => {
    if (!open || !dialog.value || dialog.value.kind !== "prompt") return;
    const next = {};
    for (const f of dialog.value.fields) next[f.key] = f.defaultValue ?? "";
    values.value = next;
    await nextTick();
    const el = firstInput.value;
    if (el) { el.focus?.(); if (typeof el.select === "function") el.select(); }
  },
  { immediate: true },
);

const canSubmit = computed(() => {
  const d = dialog.value;
  if (!d || d.kind !== "prompt") return true;
  if (d.requireMatch != null) {
    const first = d.fields[0]?.key;
    if (String(values.value[first] ?? "") !== d.requireMatch) return false;
  }
  for (const f of d.fields) {
    if (f.type === "select") continue;
    if (f.optional) continue;
    const v = String(values.value[f.key] ?? "").trim();
    if (!v) return false;
  }
  return true;
});

function captureFirst(el, i) {
  if (i !== 0) return;
  firstInput.value = el?.$el ?? el ?? null;
}

function cancel() {
  if (!dialog.value) return;
  _resolveDialog(dialog.value.kind === "confirm" ? false : null);
}

function submit() {
  const d = dialog.value;
  if (!d) return;
  if (d.kind === "confirm") { _resolveDialog(true); return; }
  if (!canSubmit.value) return;
  if (d.isSingle) {
    const v = String(values.value[d.fields[0].key] ?? "").trim();
    _resolveDialog(v);
  } else {
    const out = {};
    for (const f of d.fields) {
      const raw = values.value[f.key];
      out[f.key] = typeof raw === "string" ? raw.trim() : raw;
    }
    _resolveDialog(out);
  }
}

function onEnter(e, isLastField) {
  if (e.shiftKey) return;
  if (isLastField) { e.preventDefault(); submit(); }
}
</script>

<template>
  <DialogRoot :open="visible" @update:open="(v) => visible = v">
    <DialogPortal>
      <DialogOverlay class="jv-overlay" />
      <DialogContent class="jv-dialog">
        <header class="jv-dialog__header">
          <DialogTitle as-child>
            <div class="jv-dialog__titleblock">
              <div v-if="dialog?.title" class="jv-dialog__title">{{ dialog.title }}</div>
            </div>
          </DialogTitle>
          <DialogClose class="jv-dialog__close" aria-label="Close">
            <Icon name="Close" :size="14" />
          </DialogClose>
        </header>

        <div v-if="dialog" class="jv-dialog__body">
          <p v-if="dialog.message" class="jv-dialog__message">{{ dialog.message }}</p>

          <template v-if="dialog.kind === 'prompt'">
            <div
              v-for="(f, i) in dialog.fields"
              :key="f.key"
              class="jv-dialog__field"
            >
              <label v-if="f.label" class="jv-dialog__label" :for="`jv-field-${f.key}`">{{ f.label }}</label>
              <JvSelect
                v-if="f.type === 'select'"
                :input-id="`jv-field-${f.key}`"
                :ref="el => captureFirst(el, i)"
                v-model="values[f.key]"
                :options="f.options || []"
              />
              <JvTextarea
                v-else-if="f.type === 'textarea'"
                :id="`jv-field-${f.key}`"
                :ref="el => captureFirst(el, i)"
                :placeholder="f.placeholder || ''"
                :rows="f.rows || 6"
                v-model="values[f.key]"
                @keydown.escape.prevent="cancel"
              />
              <JvInput
                v-else
                :id="`jv-field-${f.key}`"
                :ref="el => captureFirst(el, i)"
                :type="f.type || 'text'"
                :placeholder="f.placeholder || ''"
                v-model="values[f.key]"
                @keydown.enter="onEnter($event, i === dialog.fields.length - 1)"
                @keydown.escape.prevent="cancel"
              />
              <span v-if="f.help" class="jv-dialog__help">{{ f.help }}</span>
            </div>
          </template>
        </div>

        <footer class="jv-dialog__footer">
          <JvButton variant="ghost" :label="dialog?.cancelLabel || 'Cancel'" @click="cancel" />
          <JvButton
            :variant="dialog?.danger ? 'danger' : 'primary'"
            :label="dialog?.confirmLabel || 'OK'"
            :disabled="!canSubmit"
            @click="submit"
          />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
