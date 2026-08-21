<!-- SPDX-License-Identifier: MIT -->
<!--
  WebhooksView — outbound HMAC-signed webhook subscriptions for async event
  notifications. Use cases: JustWrite gets notified on render-complete,
  CI pipelines watching for training-complete, custom integrations.
-->
<script setup>
import { onMounted, ref } from "vue";
import { webhooksService } from "../services/projects.js";
import { pushToast } from "@delebash/llm-ui";
import { confirmDialog } from "@delebash/llm-ui";
import { UiButton, UiInput, UiField, UiCheckbox, UiTag, UiTable } from "@delebash/llm-ui";

// Sorting comes with the kit grid; the hand-rolled table had none.
const WEBHOOK_COLUMNS = [
  { id: "url", accessorKey: "url", header: "URL", sortable: true },
  { id: "events", header: "Events" },
  { id: "enabled", accessorKey: "enabled", header: "Enabled", sortable: true },
  { id: "last_delivery_at", accessorKey: "last_delivery_at", header: "Last delivery", sortable: true },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%", whiteSpace: "nowrap" } },
];

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
  const ok = await confirmDialog({
    title: "Delete webhook?",
    message: `Delete webhook ${w.url}?`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
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
    <!-- MCP card (parity: the mock pairs MCP + webhooks as one
         "Automation" surface — same server speaks for agents and
         pipelines, no UI in the loop). -->
    <div class="jv-card webhooks-view__mcp">
      <div class="webhooks-view__mcp-h">
        <strong>MCP server</strong>
        <UiTag intent="success">enabled</UiTag>
        <span class="jv-spacer" />
        <a href="#settings" class="jv-muted" style="font-size:12px">configure → Settings · MCP</a>
      </div>
      <p class="jv-muted" style="font-size:12.5px; margin: 6px 0 10px">
        Any MCP-capable agent (Claude Code, IDEs) can drive JustVoice — dictate commit
        messages, voice notifications, batch-generate while you're away.
      </p>
      <pre class="webhooks-view__tools jv-mono">tools exposed
justvoice.speak           {text, voice|persona, channel}
justvoice.list_voices     → library
justvoice.list_personas   → characters
justvoice.transcribe      {audio} → text</pre>
    </div>

    <header class="jv-section">
      <!-- h3 section title (Cache-view precedent) — the tab strip already
           says "Webhooks", so the heading names the section's content. -->
      <h3 class="jv-section__title">Webhook subscriptions</h3>
      <p class="jv-muted" style="margin-top: 4px; margin-bottom: 0;">
        Server-pushed HMAC-SHA256-signed notifications for async integration —
        wire renders into a build pipeline (game VO CI) or notify when a chapter
        masters. At-least-once delivery with exponential backoff (1s → 5s → 30s → 5min).
      </p>
    </header>

    <div v-if="justCreatedSecret" class="jv-banner jv-banner--warn" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <strong>Secret (save now — won't show again):</strong>
      <code class="jv-mono secret-code">{{ justCreatedSecret }}</code>
      <div class="jv-btn-group">
        <UiButton intent="secondary" size="small" label="Copy" @click="copySecret" />
        <UiButton intent="ghost" size="small" label="Dismiss" @click="justCreatedSecret = null" />
      </div>
    </div>

    <div class="jv-section">
      <!-- The kit grid in the JustVoice look. The hand-rolled empty state was a
           `colspan` row inside <tbody>, which meant the table drew a header over
           it; `#empty` is the component's own and needs no column count. -->
      <UiTable class="jv-table-look" :data="subscriptions" :columns="WEBHOOK_COLUMNS" data-key="id" row-hover>
        <template #url="{ row }"><code class="jv-mono">{{ row.url }}</code></template>
        <template #events="{ row }"><UiTag intent="ghost">{{ row.events.length }}</UiTag></template>
        <template #enabled="{ row }">
          <UiTag v-if="row.enabled" intent="success">Enabled</UiTag>
          <span v-else class="jv-muted">—</span>
        </template>
        <template #last_delivery_at="{ row }">
          <span class="jv-muted">{{ row.last_delivery_at ? new Date(row.last_delivery_at).toLocaleString() : "never" }}</span>
        </template>
        <template #actions="{ row }">
          <div class="jv-table__actions">
            <UiButton intent="secondary" size="small" label="Test" @click="testWebhook(row)" />
            <UiButton intent="danger-outline" size="small" label="Delete" @click="deleteWebhook(row)" />
          </div>
        </template>
        <template #empty>No webhooks. Add one below.</template>
      </UiTable>
    </div>

    <UiButton v-if="!showAdd" intent="primary" label="+ Add webhook" @click="showAdd = true" />

    <section v-if="showAdd" class="jv-card jv-card--soft editor-card">
      <h3 class="jv-section__title" style="margin-bottom: 16px;">New webhook subscription</h3>

      <UiField label="URL" layout="block">
        <UiInput type="url" v-model="adding.url" placeholder="https://your-server/webhook" width="url" />
      </UiField>

      <UiField label="Events" layout="block">
        <div class="events-grid">
          <UiCheckbox
            v-for="e in EVENT_OPTIONS"
            :key="e"
            :model-value="adding.events.includes(e)"
            :label="e"
            @update:model-value="toggleEvent(e)"
          />
        </div>
      </UiField>

      <UiField label="Secret (auto-generated if blank)" layout="block">
        <UiInput type="text" v-model="adding.secret" placeholder="32 random bytes recommended" width="url" />
      </UiField>

      <div class="jv-btn-group" style="margin-top: 16px;">
        <UiButton intent="primary" label="Create" @click="createWebhook" />
        <UiButton intent="secondary" label="Cancel" @click="showAdd = false" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.webhooks-view { padding: 32px; max-width: var(--shell-page); }
.webhooks-view__mcp { padding: 14px 16px; margin-bottom: 16px; }
.webhooks-view__mcp-h { display: flex; align-items: center; gap: 8px; }
.webhooks-view__tools {
  background: var(--ink);
  color: #d7e6dc;
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.7;
  margin: 0;
  overflow-x: auto;
}
.editor-card { margin-top: 16px; }
.events-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.secret-code { background: rgba(0,0,0,0.05); padding: 4px 8px; border-radius: 4px; }
</style>
