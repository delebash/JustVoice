<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

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
  const data = await api.request("/v1/lexicons");
  lexicons.value = data.lexicons;
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
  <section class="block stack">
    <h3>New lexicon</h3>
    <div class="row">
      <input v-model="newName" placeholder="e.g. book-1-character-names" style="flex: 1;" @keydown.enter="createLexicon" />
      <button class="primary" @click="createLexicon">Create lexicon</button>
    </div>
    <p class="endnote">
      Per-render pronunciation dictionary. Apply to <span class="mono">/v1/generate</span> via
      <span class="mono">lexicons: ["lex_id"]</span>. Engine matches grapheme strings and uses your IPA / alias instead
      of its default pronunciation.
    </p>
  </section>

  <section class="block" v-if="lexicons.length">
    <h3>{{ lexicons.length }} lexicons</h3>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Entries</th>
          <th>ID</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="lx in lexicons"
          :key="lx.id"
          :class="{ active: selectedId === lx.id }"
          @click="selectedId = lx.id"
          style="cursor: pointer;"
        >
          <td><span class="em">{{ lx.name }}</span></td>
          <td>{{ (lx.entries || []).length }}</td>
          <td><span class="mono">{{ lx.id }}</span></td>
          <td>
            <button class="bare danger" @click.stop="deleteLexicon(lx.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
  <p v-else class="empty">No lexicons yet.</p>

  <section v-if="selected" class="block stack">
    <h3>{{ selected.name }} — entries</h3>
    <table v-if="(selected.entries || []).length">
      <thead>
        <tr>
          <th>Grapheme</th>
          <th>IPA</th>
          <th>Alias</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(e, i) in selected.entries" :key="i">
          <td><span class="em">{{ e.grapheme }}</span></td>
          <td><span class="mono">{{ e.phoneme_ipa || "—" }}</span></td>
          <td>{{ e.alias || "—" }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty" style="padding: 16px 0;">No entries in this lexicon yet.</p>

    <h3 style="margin-top: 4px;">Append entry</h3>
    <div class="grid-2">
      <label>
        <span>Grapheme (word as it appears)</span>
        <input v-model="newGrapheme" placeholder="Aelindor" />
      </label>
      <label>
        <span>Phoneme IPA (preferred)</span>
        <input v-model="newPhonemeIpa" placeholder="ˈeɪ.lɪn.dɔːr" />
      </label>
    </div>
    <label>
      <span>Alias (alternative — engine reads this instead of grapheme)</span>
      <input v-model="newAlias" placeholder="ay-lin-door" />
    </label>
    <div class="row">
      <button class="primary" @click="appendEntry">Append entry</button>
      <span class="endnote">Provide IPA OR alias OR both. Engine prefers IPA where supported.</span>
    </div>
  </section>
</template>
