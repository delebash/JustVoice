<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
// First-run welcome modal. Asks the producer what they're here for so
// terminology (services/copy.js), the launch tab (App.vue), and
// featured docs can adapt. Six choices in a 3x2 grid:
//   audiobook · game · podcast · dictation · multiple
// "Choose later" dismisses without committing to a primary use case
// (shown stays true so we don't re-prompt every launch — the About
// pane in Settings has a "Run welcome again" link for re-opening).
//
// Backdrop and Esc both close. Picking a card persists immediately
// via stores/onboarding.set() and emits close so App.vue can re-route
// the default tab.

import { ref } from "vue";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "reka-ui";
import Icon from "./Icon.vue";
import JvButton from "./jv/JvButton.vue";
import { useOnboarding } from "../stores/onboarding.js";

const emit = defineEmits(["close"]);

const onboarding = useOnboarding();
const open = ref(true);
const submitting = ref(false);

// Per plan Q4 / Slice 1: the "A bit of everything" card is removed from
// the primary 5-card grid (it was equal-rank with real choices, so most
// users picked it as the "safe" option and landed in the worst neutral-
// terminology mode). Users who genuinely want neutral mode use the
// tertiary "Use neutral terminology" link in the footer, which sets
// primary = "multiple" through the same store path.
const OPTIONS = [
  {
    id: "audiobook",
    emoji: "🎧",
    title: "Audiobook",
    blurb: "Long-form narration, multi-character casting, ACX mastering.",
  },
  {
    id: "game",
    emoji: "🎮",
    title: "Game",
    blurb: "NPC dialogue at scale. Per-line WAV + JSON sidecars for Unreal.",
  },
  {
    id: "podcast",
    emoji: "🎙️",
    title: "Podcast",
    blurb: "Multi-track timeline, paralinguistic tags, effects chain.",
  },
  {
    id: "dictation",
    emoji: "⌨️",
    title: "Dictation",
    blurb: "Real-time TTS with global hotkeys and agent-driven workflows.",
  },
];

async function pick(id) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await onboarding.set({ primary: id });
  } finally {
    submitting.value = false;
    open.value = false;
    // Delay the close emit by a tick so the leave transition has a
    // frame to start; mirrors the AppDialog pattern.
    setTimeout(() => emit("close"), 220);
  }
}

async function chooseLater() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await onboarding.dismiss();
  } finally {
    submitting.value = false;
    open.value = false;
    setTimeout(() => emit("close"), 220);
  }
}

function onOutside(e) {
  // Backdrop click → treat as "choose later" so the modal can be
  // dismissed without a forced selection but stays one-shot.
  e.preventDefault();
  chooseLater();
}
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => { if (!v) chooseLater(); }">
    <DialogPortal>
      <DialogOverlay class="app-modal-overlay" />
      <DialogContent
        class="app-modal app-modal--wide welcome-onboarding"
        @pointer-down-outside="onOutside"
        @interact-outside="onOutside"
      >
        <header class="app-modal-header">
          <div class="app-modal-titleblock">
            <div class="t-eyebrow welcome-eyebrow">Welcome to JustVoice</div>
            <DialogTitle as-child>
              <h2 class="welcome-title">What are you using JustVoice for?</h2>
            </DialogTitle>
            <DialogDescription as-child>
              <p class="welcome-sub">
                Pick the primary use case. We'll tune the vocabulary and the
                default tab — you can change this any time in Settings.
              </p>
            </DialogDescription>
          </div>
          <DialogClose class="app-modal-close" aria-label="Close" @click="chooseLater">
            <Icon name="Close" :size="14" />
          </DialogClose>
        </header>

        <div class="app-modal-body welcome-body">
          <div class="welcome-grid">
            <button
              v-for="opt in OPTIONS"
              :key="opt.id"
              type="button"
              class="welcome-card"
              :disabled="submitting"
              @click="pick(opt.id)"
            >
              <div class="welcome-card-emoji" aria-hidden="true">{{ opt.emoji }}</div>
              <div class="welcome-card-title">{{ opt.title }}</div>
              <div class="welcome-card-blurb">{{ opt.blurb }}</div>
            </button>
          </div>
        </div>

        <footer class="app-modal-footer welcome-footer">
          <button
            type="button"
            class="welcome-neutral-link"
            :disabled="submitting"
            @click="pick('multiple')"
          >
            Use neutral terminology
          </button>
          <JvButton
            label="Choose later"
            variant="ghost"
            :disabled="submitting"
            @click="chooseLater"
          />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.welcome-onboarding { width: min(880px, calc(100vw - 32px)); }

.welcome-eyebrow {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted, #8a8a8a);
}
.welcome-title {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.015em;
  margin: 4px 0 6px;
  color: var(--ink, #222);
}
.welcome-sub {
  font-size: 13px;
  color: var(--ink-2, #444);
  margin: 0;
  max-width: 58ch;
  line-height: 1.5;
}

.welcome-body { padding: 22px 24px; }

.welcome-grid {
  /* Five cards — 5-col on wide, 3-col on medium, 2-col on narrow.
     Dropped from 6 cards (Q4 audit): "A bit of everything" became a
     footer link. */
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
@media (max-width: 980px) {
  .welcome-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 640px) {
  .welcome-grid { grid-template-columns: repeat(2, 1fr); }
}

.welcome-neutral-link {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: var(--ink-3);
  text-decoration: underline;
  text-decoration-style: dotted;
  cursor: pointer;
  margin-right: auto;
}
.welcome-neutral-link:hover { color: var(--ink); }
.welcome-neutral-link:disabled { opacity: 0.5; cursor: default; }

.welcome-card {
  appearance: none;
  display: flex; flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 18px 16px;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e3e1dc);
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  transition: border-color .12s ease, transform .12s ease, box-shadow .12s ease, background .12s ease;
  min-height: 132px;
}
.welcome-card:hover:not(:disabled) {
  border-color: var(--accent, #3a7d63);
  background: var(--accent-soft, var(--surface-2, #faf9f6));
  box-shadow: 0 8px 24px rgba(20, 22, 24, 0.06);
  transform: translateY(-1px);
}
.welcome-card:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-soft, rgba(58, 125, 99, 0.25));
  border-color: var(--accent, #3a7d63);
}
.welcome-card:disabled { opacity: 0.6; cursor: default; }

.welcome-card-emoji {
  font-size: 28px;
  line-height: 1;
  margin-bottom: 2px;
}
.welcome-card-title {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink, #222);
}
.welcome-card-blurb {
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-2, #555);
}

.welcome-footer { justify-content: space-between; }
.welcome-footnote {
  font-size: 11.5px;
  color: var(--muted, #8a8a8a);
}
</style>
