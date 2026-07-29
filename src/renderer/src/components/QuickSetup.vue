<!-- SPDX-License-Identifier: MIT -->
<!--
  QuickSetup — post-onboarding wizard. Now multi-step + feature-pin
  auto-config per the JustWrite QuickSetup.vue / quickSetupPresets.js
  pattern (source read this turn). The earlier single-screen version
  installed engines but skipped the load-bearing recipe writes that
  make JustVoice actually configured for the user.

  Affordance Table (source: JustWrite's QuickSetup.vue:1-200 +
  quickSetupPresets.js read this turn):
    ✅ multi-step wizard (detect → confirm → install → done)
    ✅ GPU detection via /v1/system
    ✅ tier auto-pick from VRAM + manual override dropdown
    ✅ preset blurb + estimated download GB
    ✅ per-engine install progress (poll job_id via /v1/jobs/{id})
    ✅ recipe writes feature pins (speaker_attribution → Reasoned/Direct
       based on tier, compose / persona_rewrite / smart_assign / preset_suggest
       → Direct) via PUT /v1/feature-pins per pin
    ✅ LLM provider auto-recommend ("register a Claude key for richer
       attribution" or "Ollama covers Compose if you don't want cloud")
    ⚠ manual provider picker — not implemented; user goes to Engines
      after the wizard to register cloud providers
    N/A "tier mismatch" nudge — JustVoice has no saved tier yet
    ✅ done step with summary
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { UiButton, UiCheckbox, UiTag, UiSelect, AppModal } from "@delebash/llm-ui";

const emit = defineEmits(["close"]);

const api = useApi();

const open = ref(true);
const step = ref("detect");  // "detect" | "confirm" | "install" | "done"
const detectError = ref("");
const gpu = ref(null);
const engines = ref([]);
const llmProviders = ref([]);

// ── Tier recipes ────────────────────────────────────────────────────
// Per-tier recipe: which engines to install + which features to pin to
// which tier. Mirrors JustWrite's quickSetupPresets.js shape.
const TIER_RECIPES = {
  cpu: {
    label: "CPU / low VRAM",
    blurb: "Kokoro runs realtime on CPU. Speaker attribution routes through whichever LLM you register — Claude / OpenAI / Ollama.",
    ttsEngineIds: ["kokoro"],
    estimatedDownloadGb: 0.4,
    featurePins: {
      compose:               { tier: "direct" },
      persona_rewrite:       { tier: "direct" },
      speaker_attribution:   { tier: "direct" },  // Direct on CPU — Reasoned is too slow
      render_preset_suggest: { tier: "direct" },
      smart_assign:          { tier: "direct" },
    },
  },
  vram8: {
    label: "8 GB tier",
    blurb: "Kokoro + Chatterbox cover most production work. Voice cloning on 8 GB. Speaker attribution still Direct on the LLM side.",
    ttsEngineIds: ["kokoro", "chatterbox"],
    estimatedDownloadGb: 2.4,
    featurePins: {
      compose:               { tier: "direct" },
      persona_rewrite:       { tier: "direct" },
      speaker_attribution:   { tier: "direct" },
      render_preset_suggest: { tier: "direct" },
      smart_assign:          { tier: "direct" },
    },
  },
  vram12: {
    label: "12 GB tier",
    blurb: "Adds Qwen3-TTS 0.6B for natural-language delivery instructions. Speaker attribution upgrades to Reasoned for harder books.",
    ttsEngineIds: ["kokoro", "chatterbox", "qwen3"],
    estimatedDownloadGb: 4.1,
    featurePins: {
      compose:               { tier: "direct" },
      persona_rewrite:       { tier: "direct" },
      speaker_attribution:   { tier: "reasoned" },
      render_preset_suggest: { tier: "direct" },
      smart_assign:          { tier: "direct" },
    },
  },
  vram16: {
    label: "16 GB tier",
    blurb: "Adds Dia (multi-speaker dialogue). Full Reasoned-tier prompts for attribution.",
    ttsEngineIds: ["kokoro", "chatterbox", "qwen3", "dia"],
    estimatedDownloadGb: 6.8,
    featurePins: {
      compose:               { tier: "direct" },
      persona_rewrite:       { tier: "direct" },
      speaker_attribution:   { tier: "reasoned" },
      render_preset_suggest: { tier: "direct" },
      smart_assign:          { tier: "reasoned" },
    },
  },
  vram24: {
    label: "24 GB tier",
    blurb: "Adds LuxTTS + MOSS-TTS (high-fidelity production). Smart-assign + attribution both Reasoned.",
    ttsEngineIds: ["kokoro", "chatterbox", "qwen3", "dia", "luxtts", "moss_tts"],
    estimatedDownloadGb: 14.0,
    featurePins: {
      compose:               { tier: "direct" },
      persona_rewrite:       { tier: "reasoned" },
      speaker_attribution:   { tier: "reasoned" },
      render_preset_suggest: { tier: "direct" },
      smart_assign:          { tier: "reasoned" },
    },
  },
  vram32: {
    label: "32 GB+ tier",
    blurb: "Full pool including TADA Llama. Every feature routes Reasoned.",
    ttsEngineIds: ["kokoro", "chatterbox", "qwen3", "dia", "luxtts", "moss_tts", "tada"],
    estimatedDownloadGb: 22.0,
    featurePins: {
      compose:               { tier: "reasoned" },
      persona_rewrite:       { tier: "reasoned" },
      speaker_attribution:   { tier: "reasoned" },
      render_preset_suggest: { tier: "reasoned" },
      smart_assign:          { tier: "reasoned" },
    },
  },
};

const TIER_ORDER = ["cpu", "vram8", "vram12", "vram16", "vram24", "vram32"];

function tierForVramMb(mb) {
  if (!mb || mb < 7 * 1024) return "cpu";
  if (mb < 11 * 1024) return "vram8";
  if (mb < 14 * 1024) return "vram12";
  if (mb < 20 * 1024) return "vram16";
  if (mb < 28 * 1024) return "vram24";
  return "vram32";
}

// Auto-detected tier (from /v1/system) — used as the dropdown default.
const detectedTierKey = ref("cpu");
// Active tier — drives recipe selection. User can override via dropdown.
const tierKey = ref("cpu");

const recipe = computed(() => TIER_RECIPES[tierKey.value] || TIER_RECIPES.cpu);
const tierOptions = TIER_ORDER.map((k) => ({ value: k, label: TIER_RECIPES[k].label }));

// Per-engine opt-out (mock: "pick what to install") — recipe engines
// start checked; unchecking drops them from the install run.
const deselectedEngineIds = ref(new Set());
function toggleEngine(id) {
  const next = new Set(deselectedEngineIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  deselectedEngineIds.value = next;
}
const enginesToInstall = computed(() => {
  return recipe.value.ttsEngineIds
    .filter((id) => !deselectedEngineIds.value.has(id))
    .map((id) => engines.value.find((e) => e.id === id))
    .filter(Boolean)
    .filter((e) => e.status === "not_installed");
});
const enginesAlreadyInstalled = computed(() => {
  return recipe.value.ttsEngineIds
    .map((id) => engines.value.find((e) => e.id === id))
    .filter(Boolean)
    .filter((e) => e.status !== "not_installed");
});

// ── Detect step ─────────────────────────────────────────────────────
async function detect() {
  step.value = "detect";
  detectError.value = "";
  try {
    const [sys, eng, llm] = await Promise.all([
      api.safeRequest("/v1/system/info", null),
      api.safeRequest("/v1/engines", { engines: [] }),
      api.safeRequest("/v1/llm-providers", { providers: [] }),
    ]);
    if (sys?.gpus?.length) {
      gpu.value = sys.gpus[0];
    } else {
      gpu.value = { vram_mb: 0, name: "CPU only" };
    }
    engines.value = eng?.engines || [];
    llmProviders.value = llm?.providers || [];
    detectedTierKey.value = tierForVramMb(gpu.value.vram_mb || 0);
    tierKey.value = detectedTierKey.value;
  } catch (e) {
    detectError.value = e?.message || String(e);
  } finally {
    step.value = "confirm";
  }
}

// ── Install step ────────────────────────────────────────────────────
// Per-engine progress: { engineId: { jobId, phase, percent, error } }
const installProgress = ref({});
const installAborted = ref(false);

function setProgress(engineId, patch) {
  installProgress.value = {
    ...installProgress.value,
    [engineId]: { ...(installProgress.value[engineId] || {}), ...patch },
  };
}

async function pollJob(engineId, jobId) {
  while (true) {
    if (installAborted.value) return;
    let job;
    try {
      job = await api.request(`/v1/jobs/${jobId}`);
    } catch (e) {
      setProgress(engineId, { phase: "failed", error: e?.message || String(e) });
      return;
    }
    const percent = job.bytes_total > 0
      ? Math.min(100, Math.round(100 * (job.bytes_downloaded || 0) / job.bytes_total))
      : null;
    setProgress(engineId, {
      phase: job.phase,
      percent,
      error: job.error || null,
    });
    if (job.phase === "completed") return;
    if (job.phase === "failed") return;
    await new Promise((r) => setTimeout(r, 800));
  }
}

async function runInstalls() {
  step.value = "install";
  installAborted.value = false;
  for (const engine of enginesToInstall.value) {
    if (installAborted.value) break;
    setProgress(engine.id, { phase: "queued", percent: 0 });
    try {
      const accepted = await api.request(`/v1/engines/${engine.id}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (accepted?.job_id) {
        await pollJob(engine.id, accepted.job_id);
      } else {
        setProgress(engine.id, { phase: "completed", percent: 100 });
      }
    } catch (e) {
      setProgress(engine.id, { phase: "failed", error: e?.message || String(e) });
    }
  }
  // Once all engines either completed or failed, apply feature pins
  // (always — they're independent of engine install success).
  await applyFeaturePins();
  step.value = "done";
}

function cancelInstalls() {
  installAborted.value = true;
  pushToast({ message: "Install cancelled. Engines that finished are kept.", kind: "info" });
}

// ── Apply feature pin recipe ────────────────────────────────────────
const pinResults = ref({});
async function applyFeaturePins() {
  pinResults.value = {};
  // Pick the first registered LLM as the target provider. If none, all
  // pins fail with "no provider" — UI surfaces this honestly.
  const providerId = llmProviders.value[0]?.id || "";
  for (const [feature, spec] of Object.entries(recipe.value.featurePins)) {
    if (!providerId) {
      pinResults.value[feature] = { ok: false, error: "no LLM provider registered" };
      continue;
    }
    try {
      await api.request("/v1/feature-pins", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature,
          providerId,
          model: "",
          tier: spec.tier,
        }),
      });
      pinResults.value[feature] = { ok: true };
    } catch (e) {
      pinResults.value[feature] = { ok: false, error: e?.message || String(e) };
    }
  }
}

// ── Optional helpers — local LLM detect-and-connect + STT readiness ──
// (CONCEPTS §10: connect, don't bundle; skipping costs named features.)
const detectedLocal = ref([]);  // [{providerType, name, baseUrl, models, alreadyRegistered}]
const sttReadiness = ref(null); // {ready, display_name, size_mb}
const connectingLocal = ref("");

async function probeHelpers() {
  try {
    const r = await api.request("/v1/llm-providers/detect-local");
    detectedLocal.value = r?.detected || [];
  } catch { detectedLocal.value = []; }
  try {
    const r = await api.request("/v1/capture/readiness");
    sttReadiness.value = r?.stt || null;
  } catch { sttReadiness.value = null; }
}

async function connectLocal(d) {
  connectingLocal.value = d.baseUrl;
  try {
    await api.request("/v1/llm-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: d.providerType === "ollama" ? "ollama-local" : "lmstudio-local",
        name: d.name,
        providerType: d.providerType,
        baseUrl: d.baseUrl,
        apiKey: null,
        defaultModel: d.models[0] || "",
        timeoutSeconds: 120,
      }),
    });
    pushToast({ message: `${d.name} connected — feature pins can route to it.`, kind: "success" });
    await probeHelpers();
    await detect(); // refresh llmProviders so pins pick it up
  } catch (e) {
    pushToast({ message: `Connect failed: ${e?.message || e}`, kind: "error" });
  } finally {
    connectingLocal.value = "";
  }
}

// ── Lifecycle / close ──────────────────────────────────────────────
function close() {
  open.value = false;
  setTimeout(() => emit("close"), 180);
}

onMounted(() => { detect(); probeHelpers(); });

const totalInstalled = computed(() =>
  Object.values(installProgress.value).filter((p) => p.phase === "completed").length,
);
const totalFailed = computed(() =>
  Object.values(installProgress.value).filter((p) => p.phase === "failed").length,
);
const pinsApplied = computed(() =>
  Object.values(pinResults.value).filter((r) => r.ok).length,
);
const pinsFailed = computed(() =>
  Object.values(pinResults.value).filter((r) => !r.ok).length,
);
const hasLlmProvider = computed(() => llmProviders.value.length > 0);
</script>

<template>
  <AppModal
    v-if="open"
    :eyebrow="`Quick setup · step ${step === 'detect' ? '1/3' : step === 'confirm' ? '1/3' : step === 'install' ? '2/3' : '3/3'}`"
    :title="step === 'detect' ? 'Probing your hardware…' : step === 'confirm' ? 'Recommended setup' : step === 'install' ? 'Installing engines + pinning features' : 'All set'"
    :max-width="'620px'"
    no-padding
    :closable="step !== 'install'"
    :dismissable="step !== 'install'"
    @close="close"
  >
      <div class="quick-setup__body">
        <!-- ── DETECT step ───────────────────────────────────────── -->
        <div v-if="step === 'detect'" class="jv-muted quick-setup__loading">
          Probing GPU + engines + LLM providers…
        </div>

        <!-- ── CONFIRM step ─────────────────────────────────────── -->
        <template v-else-if="step === 'confirm'">
          <section>
            <div class="quick-setup__row-label">Detected</div>
            <div class="quick-setup__row-value">
              {{ gpu?.name || "No GPU" }}
              <UiTag intent="ghost" v-if="gpu?.vram_mb">{{ (gpu.vram_mb / 1024).toFixed(1) }} GB VRAM</UiTag>
              <UiTag :intent="tierKey === detectedTierKey ? 'solid' : 'ghost'">
                Auto-tier: {{ TIER_RECIPES[detectedTierKey]?.label }}
              </UiTag>
            </div>
          </section>

          <section>
            <div class="quick-setup__row-label">Tier</div>
            <div class="quick-setup__row-value">
              <UiSelect v-model="tierKey" width="name"
                :options="tierOptions.map((opt) => ({ value: opt.value, label: opt.label + (opt.value === detectedTierKey ? '  · auto' : '') }))" />
              <span v-if="tierKey !== detectedTierKey" class="jv-muted" style="font-size: 11.5px">
                Overriding auto-tier
              </span>
            </div>
            <p class="jv-muted quick-setup__blurb">{{ recipe.blurb }}</p>
          </section>

          <section>
            <div class="quick-setup__row-label">TTS engines</div>
            <ul class="quick-setup__engines">
              <li v-for="id in recipe.ttsEngineIds" :key="id" class="quick-setup__engine-row">
                <UiCheckbox
                  :model-value="!deselectedEngineIds.has(id)"
                  :disabled="enginesAlreadyInstalled.some((e) => e.id === id)"
                  :title="enginesAlreadyInstalled.some((e) => e.id === id) ? 'Already on disk' : 'Uncheck to skip this engine'"
                  @change="toggleEngine(id)"
                />
                <span class="quick-setup__engine-name">{{ engines.find((e) => e.id === id)?.name || id }}</span>
                <span v-if="engines.find((e) => e.id === id)?.description" class="jv-muted quick-setup__engine-blurb">{{ engines.find((e) => e.id === id)?.description }}</span>
                <UiTag v-if="enginesAlreadyInstalled.some((e) => e.id === id)" intent="success">already installed</UiTag>
                <UiTag intent="ghost" v-else>to install</UiTag>
              </li>
            </ul>
            <p class="jv-muted" style="font-size: 11.5px; margin: 4px 0 0">
              Estimated download: <strong>{{ recipe.estimatedDownloadGb }} GB</strong>
              · {{ enginesToInstall.length }} new · {{ enginesAlreadyInstalled.length }} already on disk
            </p>
          </section>

          <section>
            <div class="quick-setup__row-label">Feature routing</div>
            <p class="jv-muted" style="font-size: 11.5px; margin: 0 0 6px">
              AI features route themselves: careful-reading work (Script speaker attribution)
              goes to your strongest model; quick tasks (Compose, Rewrite, Smart-assign,
              preset suggestions) go to the fastest. Tune any of it later in
              Settings → AI features.
            </p>
            <div v-if="!hasLlmProvider" class="jv-banner jv-banner--warn" style="font-size: 11.5px; margin-top: 8px">
              <strong>No LLM provider registered yet.</strong> Feature pins will be queued — register Claude or Ollama on Engines → LLM tab after this wizard, then re-run pins from Settings → AI features.
            </div>
          </section>

          <section>
            <div class="quick-setup__row-label">Optional helpers</div>
            <p class="jv-muted" style="font-size: 11.5px; margin: 0 0 6px">
              Skip either — the features that need them wait quietly until you connect one.
            </p>
            <ul class="quick-setup__helpers">
              <li v-for="d in detectedLocal" :key="d.baseUrl">
                <span class="quick-setup__helper-ic">🧠</span>
                <span class="quick-setup__helper-name"><strong>{{ d.name }} detected</strong>
                  <span v-if="d.models.length" class="jv-muted"> · {{ d.models[0] }}{{ d.models.length > 1 ? ` +${d.models.length - 1}` : "" }}</span>
                </span>
                <UiTag intent="success" v-if="d.alreadyRegistered">connected</UiTag>
                <UiButton v-else size="small" intent="secondary" :loading="connectingLocal === d.baseUrl" label="Connect" :title="`Register ${d.name} as an LLM provider`" @click="connectLocal(d)" />
              </li>
              <li v-if="!detectedLocal.length">
                <span class="quick-setup__helper-ic">🧠</span>
                <span class="quick-setup__helper-name jv-muted">No local LLM server detected (Ollama :11434 / LM Studio :1234) — Script attribution + Smart-assign stay manual until one is connected.</span>
              </li>
              <li v-if="sttReadiness">
                <span class="quick-setup__helper-ic">🎤</span>
                <span class="quick-setup__helper-name"><strong>STT — {{ sttReadiness.display_name }}</strong>
                  <span class="jv-muted"> · Train transcripts + capture promotion + dictation</span>
                </span>
                <UiTag intent="success" v-if="sttReadiness.ready">cached</UiTag>
                <UiTag intent="ghost" v-else  :title="'Downloads on first use'">{{ sttReadiness.size_mb ? `${sttReadiness.size_mb} MB on first use` : "downloads on first use" }}</UiTag>
              </li>
            </ul>
          </section>

          <section>
            <div class="quick-setup__row-label">What happens next</div>
            <ol class="quick-setup__next">
              <li>Engines download &amp; verify (one-time)</li>
              <li>Clone your voice from ~30 s of audio — or skip and use preset voices</li>
              <li>Pick what you're making (audiobook · game · podcast) and import</li>
            </ol>
            <div class="jv-banner jv-banner--info" style="font-size: 11.5px; margin-top: 8px">
              Everything runs <strong>locally</strong>. No audio or text leaves this machine
              unless you add an external provider yourself.
            </div>
          </section>
        </template>

        <!-- ── INSTALL step ─────────────────────────────────────── -->
        <template v-else-if="step === 'install'">
          <p class="jv-muted" style="font-size: 12px; margin: 0 0 10px">
            Engines install one at a time; feature pins apply once installs finish.
          </p>
          <ul class="quick-setup__progress-list">
            <li v-for="engine in enginesToInstall" :key="engine.id" class="quick-setup__progress-row">
              <strong>{{ engine.name }}</strong>
              <span class="jv-muted" style="font-size: 11px">{{ engine.id }}</span>
              <div class="quick-setup__progress-bar">
                <div
                  class="quick-setup__progress-fill"
                  :class="{
                    'quick-setup__progress-fill--done': installProgress[engine.id]?.phase === 'completed',
                    'quick-setup__progress-fill--err': installProgress[engine.id]?.phase === 'failed',
                  }"
                  :style="{ width: (installProgress[engine.id]?.percent ?? 0) + '%' }"
                />
              </div>
              <span class="quick-setup__progress-state jv-muted">
                {{ installProgress[engine.id]?.phase || "waiting" }}
                {{ installProgress[engine.id]?.percent != null ? `· ${installProgress[engine.id].percent}%` : "" }}
              </span>
              <span v-if="installProgress[engine.id]?.error" class="quick-setup__progress-err">
                {{ installProgress[engine.id].error }}
              </span>
            </li>
          </ul>
        </template>

        <!-- ── DONE step ────────────────────────────────────────── -->
        <template v-else>
          <p>
            <strong>{{ totalInstalled }}</strong> engine{{ totalInstalled === 1 ? "" : "s" }} installed
            <span v-if="totalFailed">· <strong>{{ totalFailed }}</strong> failed</span>
            · <strong>{{ pinsApplied }}</strong> feature pin{{ pinsApplied === 1 ? "" : "s" }} applied
            <span v-if="pinsFailed">· <strong>{{ pinsFailed }}</strong> deferred</span>.
          </p>
          <p v-if="!hasLlmProvider" class="jv-muted" style="font-size: 12px">
            No LLM provider was registered, so feature pins didn't apply.
            Open <a href="#engines">Engines → LLM tab</a> to add Claude / OpenAI / Ollama / DeepSeek, then revisit
            <a href="#settings">Settings → AI features</a> to confirm the pins took.
          </p>
          <p v-else-if="pinsFailed" class="jv-muted" style="font-size: 12px">
            Some pins failed — re-apply individually from <a href="#settings">Settings → AI features</a>.
          </p>
        </template>
      </div>

      <template #footer>
        <template v-if="step === 'confirm'">
          <UiButton intent="ghost" label="Skip — configure later" @click="close" />
          <span class="jv-spacer" />
          <UiButton
            intent="primary"
            :label="enginesToInstall.length
              ? `Install ${enginesToInstall.length} engine${enginesToInstall.length === 1 ? '' : 's'} + apply pins`
              : hasLlmProvider ? 'Apply feature pins' : 'Finish — connect an LLM later'"
            title="Nothing here blocks you: AI features wait quietly until an LLM is connected (Engines → Online providers)"
            @click="enginesToInstall.length || hasLlmProvider ? runInstalls() : close()"
          />
        </template>
        <template v-else-if="step === 'install'">
          <UiButton intent="ghost" label="Cancel" @click="cancelInstalls" />
        </template>
        <template v-else-if="step === 'done'">
          <span class="jv-spacer" />
          <UiButton intent="primary" label="Close" @click="close" />
        </template>
      </template>
  </AppModal>
</template>

<style scoped>
.quick-setup__body { padding: 18px 22px; display: flex; flex-direction: column; gap: 18px; }
.quick-setup__loading { text-align: center; padding: 24px 0; }
.quick-setup__row-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
  margin-bottom: 4px;
}
.quick-setup__row-value {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}
.quick-setup__blurb { font-size: 12px; line-height: 1.5; margin: 6px 0 0; }
.quick-setup__engines, .quick-setup__pins {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quick-setup__engines li, .quick-setup__pins li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: var(--surface-2);
  border-radius: 4px;
  font-size: 12px;
}
.quick-setup__pins code {
  font-family: var(--font-mono);
  font-size: 11px;
}
.quick-setup__progress-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.quick-setup__progress-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 10px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-radius: 4px;
}
.quick-setup__progress-row strong { grid-column: 1; font-size: 12.5px; }
.quick-setup__progress-row > span:nth-child(2) { grid-column: 2; }
.quick-setup__progress-bar {
  grid-column: 1 / -1;
  height: 4px;
  background: var(--surface);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}
.quick-setup__progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.18s ease-out;
}
.quick-setup__progress-fill--done { background: var(--accent); }
.quick-setup__progress-fill--err { background: var(--danger); }
.quick-setup__progress-state { grid-column: 1 / -1; font-size: 11px; }
.quick-setup__progress-err { grid-column: 1 / -1; font-size: 11px; color: var(--danger); }
.quick-setup__helpers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.quick-setup__helpers li {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font-size: 12.5px;
}
.quick-setup__helper-ic { flex: none; }
.quick-setup__helper-name { flex: 1; min-width: 0; }
.quick-setup__engine-row { display: flex; align-items: center; gap: 8px; }
.quick-setup__engine-row input { accent-color: var(--accent); width: 15px; height: 15px; flex: none; }
.quick-setup__engine-name { font-weight: 600; }
.quick-setup__engine-blurb { font-size: 11px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-setup__next { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.8; }
</style>
