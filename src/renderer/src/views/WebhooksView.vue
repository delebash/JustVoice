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
  <div class="webhooks">
    <header>
      <h2>Webhooks</h2>
      <p class="lede">
        Server-pushed HMAC-SHA256-signed notifications for async integration.
        At-least-once delivery with exponential backoff (1s → 5s → 30s → 5min).
      </p>
    </header>

    <div v-if="justCreatedSecret" class="webhooks__secret">
      <strong>Secret (save now — won't show again):</strong>
      <code>{{ justCreatedSecret }}</code>
      <button class="btn" @click="copySecret">Copy</button>
      <button class="btn" @click="justCreatedSecret = null">Dismiss</button>
    </div>

    <table class="webhooks__table">
      <thead>
        <tr><th>URL</th><th>Events</th><th>Enabled</th><th>Last delivery</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-if="subscriptions.length === 0">
          <td colspan="5" class="webhooks__empty">No webhooks. Add one below.</td>
        </tr>
        <tr v-for="w in subscriptions" :key="w.id">
          <td><code>{{ w.url }}</code></td>
          <td>{{ w.events.length }}</td>
          <td>{{ w.enabled ? "✓" : "—" }}</td>
          <td>{{ w.last_delivery_at ? new Date(w.last_delivery_at).toLocaleString() : "never" }}</td>
          <td>
            <button class="btn" @click="testWebhook(w)">Test</button>
            <button class="btn btn--danger" @click="deleteWebhook(w)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    <button v-if="!showAdd" class="btn btn--primary" @click="showAdd = true">+ Add webhook</button>

    <section v-if="showAdd" class="webhooks__editor">
      <h3>New webhook subscription</h3>
      <div class="form-row">
        <label>URL</label>
        <input type="url" v-model="adding.url" placeholder="https://your-server/webhook" />
      </div>
      <div class="form-row">
        <label>Events</label>
        <div class="webhooks__events">
          <label v-for="e in EVENT_OPTIONS" :key="e" class="webhooks__event">
            <input type="checkbox" :checked="adding.events.includes(e)" @change="toggleEvent(e)" />
            <span>{{ e }}</span>
          </label>
        </div>
      </div>
      <div class="form-row">
        <label>Secret (auto-generated if blank)</label>
        <input type="text" v-model="adding.secret" placeholder="32 random bytes recommended" />
      </div>
      <div class="form-actions">
        <button class="btn btn--primary" @click="createWebhook">Create</button>
        <button class="btn" @click="showAdd = false">Cancel</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.webhooks { padding: 32px; max-width: 1100px; }
.lede { color: var(--ink-2, #4a4a4a); margin: 4px 0 24px; }
.webhooks__secret { background: var(--warn-bg, #fffbe6); border: 1px solid var(--warn, #c89a3a); padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.webhooks__secret code { background: rgba(0,0,0,0.05); padding: 4px 8px; border-radius: 4px; font-family: ui-monospace, "SF Mono", monospace; font-size: 12px; }
.webhooks__table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.webhooks__table th, .webhooks__table td { padding: 8px 12px; border-bottom: 1px solid var(--line, #e3e1dc); text-align: left; font-size: 13px; }
.webhooks__table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3, #888); }
.webhooks__table code { font-family: ui-monospace, "SF Mono", monospace; font-size: 12px; }
.webhooks__empty { color: var(--ink-3, #888); font-style: italic; text-align: center; padding: 20px; }
.webhooks__editor { background: var(--surface-2, #fbfaf7); border: 1px solid var(--line, #e3e1dc); border-radius: 6px; padding: 20px; margin-top: 16px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3, #888); margin-bottom: 4px; }
.form-row input[type="text"], .form-row input[type="url"] { width: 100%; padding: 8px 12px; border: 1px solid var(--line, #e3e1dc); border-radius: 6px; font-size: 13px; }
.webhooks__events { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
.webhooks__event { display: flex; gap: 6px; align-items: center; text-transform: none; letter-spacing: 0; color: inherit; font-size: 12px; }
.form-actions { display: flex; gap: 8px; }
.btn { height: 32px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--line-strong, #cfccc4); background: var(--surface-2, #fbfaf7); color: inherit; }
.btn--primary { background: var(--accent, #3a7d63); color: #fff; border-color: var(--accent, #3a7d63); }
.btn--danger { background: transparent; color: var(--danger, #a8442e); border-color: var(--danger, #a8442e); }
</style>
