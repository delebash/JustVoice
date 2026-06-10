<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  QuickSetup — post-onboarding wizard that gets the user from zero to
  "useful" in one screen. Plan Q4 task #18.

  Flow:
    1. Probe GPU via /v1/system → detect VRAM tier.
    2. Show the recipe for that tier — recommended TTS engine + LLM tier.
    3. User clicks "Install recommendations" → triggers /v1/engines/{id}/install
       for each engine, and saves feature-pin defaults pointing at the
       chosen LLM tier (when one is registered).
    4. User can also skip and configure manually later.

  Tier thresholds match JustWrite's quickSetupPresets.js mapping:
    cpu    (<7  GB) → Kokoro (realtime CPU); no LLM auto-install
    8  GB  (7-11)  → Kokoro + Chatterbox; Direct-tier LLM
    12 GB  (11-14) → Kokoro + Chatterbox + Qwen3-0.6B; Direct/Reasoned LLM
    16 GB  (14-20) → adds Qwen3-1.7B, Dia
    24 GB  (20-28) → adds LuxTTS, MOSS-TTS
    32 GB+ (28+)   → full pool, including TADA Llama
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "./jv/JvButton.vue";

const emit = defineEmits(["close"]);

const api = useApi();

const open = ref(true);
const probing = ref(true);
const installing = ref(false);
const gpu = ref(null);
const engines = ref([]);
const installed = ref(new Set());

const TIER_RECIPES = {
  cpu: {
    label: "CPU-only / low VRAM",
    blurb: "Kokoro is realtime on CPU and ships with 54 voices. No GPU-bound engines.",
    engineIds: ["kokoro"],
    llmTier: null,
  },
  vram8: {
    label: "8 GB tier",
    blurb: "Kokoro + Chatterbox cover most use cases. Direct-tier LLM gives fast attribution.",
    engineIds: ["kokoro", "chatterbox"],
    llmTier: "direct",
  },
  vram12: {
    label: "12 GB tier",
    blurb: "Adds Qwen3-TTS 0.6B (free-form delivery instructions).",
    engineIds: ["kokoro", "chatterbox", "qwen3"],
    llmTier: "direct",
  },
  vram16: {
    label: "16 GB tier",
    blurb: "Adds Dia (multi-speaker dialogue).",
    engineIds: ["kokoro", "chatterbox", "qwen3", "dia"],
    llmTier: "reasoned",
  },
  vram24: {
    label: "24 GB tier",
    blurb: "Adds LuxTTS + MOSS-TTS (high-fidelity production).",
    engineIds: ["kokoro", "chatterbox", "qwen3", "dia", "luxtts", "moss_tts"],
    llmTier: "reasoned",
  },
  vram32: {
    label: "32 GB+ tier",
    blurb: "Full engine pool including TADA Llama.",
    engineIds: ["kokoro", "chatterbox", "qwen3", "dia", "luxtts", "moss_tts", "tada"],
    llmTier: "reasoned",
  },
};

function tierForVramMb(mb) {
  if (!mb || mb < 7 * 1024) return "cpu";
  if (mb < 11 * 1024) return "vram8";
  if (mb < 14 * 1024) return "vram12";
  if (mb < 20 * 1024) return "vram16";
  if (mb < 28 * 1024) return "vram24";
  return "vram32";
}

const tier = computed(() => tierForVramMb(gpu.value?.vram_mb || 0));
const recipe = computed(() => TIER_RECIPES[tier.value] || TIER_RECIPES.cpu);

const enginesToInstall = computed(() => {
  return recipe.value.engineIds
    .map((id) => engines.value.find((e) => e.id === id))
    .filter(Boolean);
});

async function probe() {
  probing.value = true;
  try {
    const [sys, eng] = await Promise.all([
      api.safeRequest("/v1/system", null),
      api.safeRequest("/v1/engines", { engines: [] }),
    ]);
    if (sys?.gpus?.length) {
      gpu.value = sys.gpus[0];
    } else {
      gpu.value = { vram_mb: 0, name: "CPU only" };
    }
    engines.value = eng?.engines || [];
    installed.value = new Set(
      engines.value
        .filter((e) => e.status !== "not_installed")
        .map((e) => e.id),
    );
  } finally {
    probing.value = false;
  }
}

async function installRecommendations() {
  installing.value = true;
  const toInstall = enginesToInstall.value.filter(
    (e) => !installed.value.has(e.id) && e.status === "not_installed",
  );
  if (!toInstall.length) {
    pushToast({ message: "Everything in the recipe is already installed.", kind: "info" });
    installing.value = false;
    close();
    return;
  }
  pushToast({
    message: `Installing ${toInstall.length} engine${toInstall.length === 1 ? "" : "s"} in the background. Track progress in Engines.`,
    kind: "info",
    duration: 5000,
  });
  // Fire-and-forget — installs are long-running and tracked through
  // the EnginesView job system; we just kick them off here.
  for (const e of toInstall) {
    api.request(`/v1/engines/${e.id}/install`, { method: "POST" }).catch(() => { /* tracked in Engines tab */ });
  }
  close();
}

function close() {
  open.value = false;
  setTimeout(() => emit("close"), 180);
}

onMounted(probe);
</script>

<template>
  <div v-if="open" class="jv-overlay" @click.self="close">
    <div class="jv-modal quick-setup">
      <header class="jv-modal__header">
        <div class="jv-modal__titleblock">
          <span class="jv-modal__eyebrow">Quick setup</span>
          <h3 class="jv-modal__title">Let's get you producing</h3>
        </div>
        <button type="button" class="jv-modal__close" @click="close">✕</button>
      </header>

      <div class="jv-modal__body quick-setup__body">
        <div v-if="probing" class="jv-muted quick-setup__loading">
          Probing your hardware…
        </div>
        <template v-else>
          <section class="quick-setup__detected">
            <div class="quick-setup__detected-label">Detected</div>
            <div class="quick-setup__detected-value">
              {{ gpu?.name || "No GPU" }}
              <span class="jv-pill jv-pill--ghost" v-if="gpu?.vram_mb">
                {{ (gpu.vram_mb / 1024).toFixed(1) }} GB VRAM
              </span>
            </div>
          </section>

          <section class="quick-setup__recipe">
            <div class="quick-setup__recipe-h">
              <span class="jv-pill jv-pill--solid">{{ recipe.label }}</span>
              <span class="jv-muted">{{ recipe.blurb }}</span>
            </div>
            <ul class="quick-setup__engines">
              <li
                v-for="e in enginesToInstall"
                :key="e.id"
                class="quick-setup__engine"
              >
                <strong>{{ e.name }}</strong>
                <span v-if="installed.has(e.id)" class="jv-pill jv-pill--green">already installed</span>
                <span v-else class="jv-pill jv-pill--ghost">{{ e.status }}</span>
              </li>
            </ul>
          </section>

          <p class="jv-muted quick-setup__note">
            Installs happen in the background. You can register LLM providers (Claude / OpenAI / Ollama / etc.) any time in <a href="#engines">Engines → LLM tab</a>.
          </p>
        </template>
      </div>

      <footer class="jv-modal__footer">
        <JvButton variant="ghost" label="Skip — configure later" @click="close" />
        <span class="jv-spacer" />
        <JvButton
          variant="primary"
          :loading="installing"
          :disabled="probing || installing"
          :label="enginesToInstall.length ? `Install ${enginesToInstall.length} engine${enginesToInstall.length === 1 ? '' : 's'}` : 'OK'"
          @click="installRecommendations"
        />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.quick-setup { width: min(560px, calc(100vw - 32px)); }
.quick-setup__body { padding: 18px 22px; display: flex; flex-direction: column; gap: 18px; }
.quick-setup__loading { text-align: center; padding: 24px 0; }
.quick-setup__detected-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
  margin-bottom: 4px;
}
.quick-setup__detected-value { font-size: 14px; display: flex; align-items: center; gap: 8px; }
.quick-setup__recipe-h {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.quick-setup__engines { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.quick-setup__engine {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface-2);
  border-radius: 4px;
  font-size: 12.5px;
}
.quick-setup__note { font-size: 12px; line-height: 1.5; margin: 0; }
</style>
