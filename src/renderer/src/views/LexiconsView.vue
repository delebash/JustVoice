<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvField from "../components/jv/JvField.vue";

const api = useApi();
const lexicons = ref([]);
const selectedId = ref(null);

// New lexicon form
const newName = ref("");

// New entry form
const newGrapheme = ref("");
const newPhonemeIpa = ref("");
const newAlias = ref("");

const selected = computed(() => lexicons.value.find((lx) => lx.id === selectedId.value) ?? null);

async function refresh() {
  const data = await api.safeRequest("/v1/lexicons", { lexicons: [] });
  lexicons.value = data?.lexicons ?? [];
}

async function createLexicon() {
  if (!newName.value.trim()) return;
  try {
    await api.request("/v1/lexicons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.value.trim(), entries: [] }),
    });
    newName.value = "";
    await refresh();
    pushToast({ message: "Lexicon created." });
  } catch (e) {
    pushToast({ message: `Create failed: ${e.message || e}`, kind: "error" });
  }
}

async function deleteLexicon(id) {
  const lx = lexicons.value.find((l) => l.id === id);
  const ok = await confirmDialog({
    title: "Delete lexicon?",
    message: `"${lx?.name ?? id}" and all its entries will be permanently removed.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/lexicons/${id}`, { method: "DELETE" });
    if (selectedId.value === id) selectedId.value = null;
    await refresh();
    pushToast({ message: "Lexicon deleted." });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}

async function appendEntry() {
  if (!selectedId.value || !newGrapheme.value.trim()) return;
  const entry = { grapheme: newGrapheme.value.trim() };
  if (newPhonemeIpa.value.trim()) entry.phoneme_ipa = newPhonemeIpa.value.trim();
  if (newAlias.value.trim()) entry.alias = newAlias.value.trim();
  try {
    await api.request(`/v1/lexicons/${selectedId.value}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    newGrapheme.value = "";
    newPhonemeIpa.value = "";
    newAlias.value = "";
    await refresh();
    pushToast({ message: "Entry appended." });
  } catch (e) {
    pushToast({ message: `Append failed: ${e.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
</script>

<template>
  <!-- Create lexicon -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">New lexicon</h3>
      </div>
      <div class="jv-row" style="margin-bottom: 12px;">
        <JvInput
          v-model="newName"
          placeholder="e.g. book-1-character-names"
          style="flex: 1;"
          @keydown.enter="createLexicon"
        />
        <JvButton variant="primary" @click="createLexicon">Create lexicon</JvButton>
      </div>
      <p class="jv-muted" style="font-size: 12px;">
        Per-render pronunciation dictionary. Apply to <code class="jv-mono">/v1/generate</code> via
        <code class="jv-mono">lexicons: ["lex_id"]</code>. Engine matches grapheme strings and uses your IPA / alias instead
        of its default pronunciation.
      </p>
    </div>
  </div>

  <!-- List + detail pane -->
  <div v-if="lexicons.length" class="jv-pane jv-section">
    <!-- List -->
    <div class="jv-pane-list">
      <div
        v-for="lx in lexicons"
        :key="lx.id"
        class="jv-pane-list__item"
        :class="{ 'jv-pane-list__item--active': selectedId === lx.id }"
        @click="selectedId = lx.id"
      >
        <div class="jv-row" style="justify-content: space-between; align-items: center;">
          <div>
            <strong>{{ lx.name }}</strong>
            <span class="jv-pane-list__meta">{{ (lx.entries || []).length }} entries · <code class="jv-mono" style="font-size: 10px;">{{ lx.id }}</code></span>
          </div>
          <JvButton variant="danger-outline" size="sm" @click.stop="deleteLexicon(lx.id)">Delete</JvButton>
        </div>
      </div>
    </div>

    <!-- Detail -->
    <div class="jv-pane-detail">
      <template v-if="selected">
        <div class="jv-card__header" style="margin-bottom: 16px;">
          <h3 class="jv-card__title">{{ selected.name }}</h3>
          <span class="jv-muted" style="font-size: 12px;">{{ (selected.entries || []).length }} entries</span>
        </div>

        <table v-if="(selected.entries || []).length" class="jv-table" style="margin-bottom: 20px;">
          <thead>
            <tr>
              <th>Grapheme</th>
              <th>IPA</th>
              <th>Alias</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in selected.entries" :key="i">
              <td><strong>{{ e.grapheme }}</strong></td>
              <td><code class="jv-mono">{{ e.phoneme_ipa || "—" }}</code></td>
              <td class="jv-muted">{{ e.alias || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-muted" style="padding: 16px 0; font-style: italic;">No entries in this lexicon yet.</p>

        <div class="jv-divider"></div>

        <h4 style="margin-bottom: 14px;">Append entry</h4>
        <div class="entry-grid">
          <JvField label="Grapheme (word as written)" layout="block">
            <JvInput v-model="newGrapheme" placeholder="Aelindor" />
          </JvField>
          <JvField label="Phoneme IPA (preferred)" layout="block">
            <JvInput v-model="newPhonemeIpa" placeholder="ˈeɪ.lɪn.dɔːr" />
          </JvField>
        </div>
        <JvField label="Alias (engine reads this instead)" layout="block" style="margin-top: 12px;">
          <JvInput v-model="newAlias" placeholder="ay-lin-door" />
        </JvField>
        <div class="jv-row" style="margin-top: 14px;">
          <JvButton variant="primary" @click="appendEntry">Append entry</JvButton>
          <span class="jv-muted" style="font-size: 12px;">Provide IPA OR alias OR both. Engine prefers IPA where supported.</span>
        </div>
      </template>
      <p v-else class="jv-muted" style="font-style: italic;">Select a lexicon to view or edit its entries.</p>
    </div>
  </div>

  <p v-else class="jv-muted" style="font-style: italic; padding: 16px 0;">No lexicons yet.</p>
</template>

<style scoped>
.entry-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
</style>
