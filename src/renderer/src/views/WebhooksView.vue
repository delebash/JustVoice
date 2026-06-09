<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  WebhooksView — outbound HMAC-signed webhook subscriptions for async event
  notifications. Use cases: JustWrite gets notified on render-complete,
  CI pipelines watching for training-complete, custom integrations.
-->
<script setup>
import { onMounted, ref } from "vue";
import { webhooksService } from "../services/projects.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvField from "../components/jv/JvField.vue";
import JvCheckbox from "../components/jv/JvCheckbox.vue";

const EVENT_OPTIONS = [
  "render.completed",
  "render.failed",
  "generation.created",
  "voice.created",
  "training.completed",
  "training.failed",
  "model.download.completed",
  "model.download.failed",
];

const subscriptions = ref([]);
const showAdd = ref(false);
const adding = ref({ url: "", events: [], secret: "", enabled: true });
const justCreatedSecret = ref(null);

async function refresh() {
  try {
    const res = await webhooksService.list();
    subscriptions.value = res.subscriptions ?? [];
  } catch (e) {
    pushToast({ kind: "error", title: "Couldn't load webhooks", description: String(e?.message ?? e) });
  }
}

async function createWebhook() {
  if (!adding.value.url || adding.value.events.length === 0) {
    pushToast({ kind: "warning", title: "URL + at least 1 event required" });
    return;
  }
  try {
    const result = await webhooksService.create({
      url: adding.value.url,
      events: adding.value.events,
      secret: adding.value.secret || null,
      enabled: adding.value.enabled,
    });
    justCreatedSecret.value = result.secret;
    pushToast({ kind: "success", title: "Webhook created", description: "Copy the secret now — it won't show again" });
    adding.value = { url: "", events: [], secret: "", enabled: true };
    showAdd.value = false;
    await refresh();
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
  }
}

async function deleteWebhook(w) {
  if (!confirm(`Delete webhook ${w.url}?`)) return;
  try {
    await webhooksService.remove(w.id);
    await refresh();
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

async function testWebhook(w) {
  try {
    const result = await webhooksService.test(w.id);
    if (result.delivered) {
      pushToast({ kind: "success", title: `Test delivered (${result.status_code}, ${result.latency_ms}ms)` });
    } else {
      pushToast({ kind: "error", title: "Test failed", description: result.error || `HTTP ${result.status_code}` });
    }
  } catch (e) {
    pushToast({ kind: "error", title: "Test failed", description: String(e?.message ?? e) });
  }
}

function toggleEvent(evt) {
  const idx = adding.value.events.indexOf(evt);
  if (idx >= 0) adding.value.events.splice(idx, 1);
  else adding.value.events.push(evt);
}

function copySecret() {
  if (!justCreatedSecret.value) return;
  navigator.clipboard.writeText(justCreatedSecret.value);
  pushToast({ kind: "success", title: "Secret copied to clipboard" });
}

onMounted(refresh);
</script>

<template>
  <div class="webhooks-view">
    <header class="jv-section">
      <h2 class="jv-section__title">Webhooks</h2>
      <p class="jv-muted" style="margin-top: 4px; margin-bottom: 0;">
        Server-pushed HMAC-SHA256-signed notifications for async integration.
        At-least-once delivery with exponential backoff (1s → 5s → 30s → 5min).
      </p>
    </header>

    <div v-if="justCreatedSecret" class="jv-banner jv-banner--warn" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <strong>Secret (save now — won't show again):</strong>
      <code class="jv-mono secret-code">{{ justCreatedSecret }}</code>
      <div class="jv-btn-group">
        <JvButton variant="secondary" size="sm" label="Copy" @click="copySecret" />
        <JvButton variant="ghost" size="sm" label="Dismiss" @click="justCreatedSecret = null" />
      </div>
    </div>

    <div class="jv-section">
      <table class="jv-table">
        <thead>
          <tr>
            <th>URL</th>
            <th>Events</th>
            <th>Enabled</th>
            <th>Last delivery</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="subscriptions.length === 0">
            <td colspan="5" class="jv-table__empty">No webhooks. Add one below.</td>
          </tr>
          <tr v-for="w in subscriptions" :key="w.id">
            <td><code class="jv-mono">{{ w.url }}</code></td>
            <td><span class="jv-pill">{{ w.events.length }}</span></td>
            <td>
              <span v-if="w.enabled" class="jv-pill jv-pill--green">Enabled</span>
              <span v-else class="jv-muted">—</span>
            </td>
            <td class="jv-muted">{{ w.last_delivery_at ? new Date(w.last_delivery_at).toLocaleString() : "never" }}</td>
            <td>
              <div class="jv-table__actions">
                <JvButton variant="secondary" size="sm" label="Test" @click="testWebhook(w)" />
                <JvButton variant="danger-outline" size="sm" label="Delete" @click="deleteWebhook(w)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <JvButton v-if="!showAdd" variant="primary" label="+ Add webhook" @click="showAdd = true" />

    <section v-if="showAdd" class="jv-card jv-card--soft editor-card">
      <h3 class="jv-section__title" style="margin-bottom: 16px;">New webhook subscription</h3>

      <JvField label="URL" layout="block">
        <JvInput type="url" v-model="adding.url" placeholder="https://your-server/webhook" />
      </JvField>

      <JvField label="Events" layout="block">
        <div class="events-grid">
          <JvCheckbox
            v-for="e in EVENT_OPTIONS"
            :key="e"
            :model-value="adding.events.includes(e)"
            :label="e"
            @update:model-value="toggleEvent(e)"
          />
        </div>
      </JvField>

      <JvField label="Secret (auto-generated if blank)" layout="block">
        <JvInput type="text" v-model="adding.secret" placeholder="32 random bytes recommended" />
      </JvField>

      <div class="jv-btn-group" style="margin-top: 16px;">
        <JvButton variant="primary" label="Create" @click="createWebhook" />
        <JvButton variant="secondary" label="Cancel" @click="showAdd = false" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.webhooks-view { padding: 32px; max-width: 1100px; }
.editor-card { margin-top: 16px; }
.events-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.secret-code { background: rgba(0,0,0,0.05); padding: 4px 8px; border-radius: 4px; }
</style>
