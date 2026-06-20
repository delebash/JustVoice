<!-- SPDX-License-Identifier: MIT AND GPL-3.0-or-later -->
<!--
  JvHelpDrawer — right-side slide-in help drawer. Mounted once in App.vue;
  every "?" button (HelpTrigger) calls ui.openHelp(slug) to open it.

  Renders docs/<slug>.md via marked.js. Intra-doc links open inside the
  drawer rather than navigating the app.

  Lifted with adaptation from JustWrite's JwHelpDrawer.vue. Differences:
  no vue-router (JustVoice uses a `view` ref in App.vue, not routes),
  drop the "Open full docs" router push, drop the marketing-site
  "Open on the web" button (JustVoice has no public docs site yet —
  add when we host them).

  MIT notice for upstream-derived portions; JustVoice changes
  GPL-3.0-or-later.
-->
<script setup>
import { computed, watch, nextTick, ref } from "vue";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "reka-ui";
import { useUIStore } from "../stores/ui.js";
import { loadDoc, hasDoc, titleForSlug } from "../services/helpDocs.js";
import { renderHelpMarkdown } from "../services/helpMarkdown.js";

const ui = useUIStore();

const open = computed({
  get: () => ui.helpDrawerSlug !== null,
  set: (v) => { if (!v) ui.closeHelp(); },
});

const slug = computed(() => ui.helpDrawerSlug || "");
const title = computed(() => titleForSlug(slug.value));
const rawDoc = ref(null);
const renderedHtml = computed(() => renderHelpMarkdown(rawDoc.value));
const exists = computed(() => hasDoc(slug.value));

const contentEl = ref(null);

// Load the doc lazily when the drawer opens / navigates (not at app boot).
watch(slug, async (s) => {
  rawDoc.value = s ? await loadDoc(s) : null;
  await nextTick();
  contentEl.value?.scrollTo({ top: 0, behavior: "auto" });
}, { immediate: true });

function onContentClick(e) {
  const a = e.target.closest("a[data-help-link]");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") || "";
  // /help[/<slug>][#anchor] — jump to another doc in the drawer.
  const m = href.match(/^\/help(?:\/([^#]+))?(#.+)?$/);
  if (m) {
    ui.openHelp(m[1] || "");
  }
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="jv-help-drawer__overlay" />
      <DialogContent class="jv-help-drawer" aria-label="Help">
        <header class="jv-help-drawer__header">
          <DialogTitle as-child>
            <div class="jv-help-drawer__titleblock">
              <div class="jv-help-drawer__eyebrow">Help</div>
              <div class="jv-help-drawer__title">{{ title }}</div>
            </div>
          </DialogTitle>
          <DialogClose class="jv-help-drawer__close" aria-label="Close help">×</DialogClose>
        </header>

        <div ref="contentEl" class="jv-help-drawer__body" @click="onContentClick">
          <article v-if="renderedHtml" class="jv-help-drawer__prose" v-html="renderedHtml" />
          <div v-else class="jv-help-drawer__empty">
            <p>No help article for this surface yet.</p>
          </div>
        </div>

        <footer class="jv-help-drawer__footer">
          <span class="jv-help-drawer__slug" v-if="exists"><code>docs/{{ slug }}.md</code></span>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.jv-help-drawer__overlay {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(20, 22, 24, 0.32);
  animation: jvHelpFadeIn 160ms ease;
}
.jv-help-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 92vw);
  z-index: 251;
  background: var(--surface);
  color: var(--ink);
  border-left: 1px solid var(--line);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.10);
  display: flex;
  flex-direction: column;
  animation: jvHelpSlideIn 220ms cubic-bezier(.22, 1, .36, 1);
  outline: none;
}
@keyframes jvHelpFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes jvHelpSlideIn {
  from { transform: translateX(8%); opacity: 0; }
  to   { transform: translateX(0);  opacity: 1; }
}

.jv-help-drawer__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--line);
}
.jv-help-drawer__titleblock { min-width: 0; }
.jv-help-drawer__eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 2px;
}
.jv-help-drawer__title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--ink);
}
.jv-help-drawer__close {
  appearance: none;
  border: 0;
  background: transparent;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: var(--r-control, 6px);
  cursor: pointer;
  color: var(--ink-3);
  font-size: 18px;
  line-height: 1;
}
.jv-help-drawer__close:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.jv-help-drawer__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px 28px;
}
.jv-help-drawer__prose {
  font-size: 14px;
  line-height: 1.65;
  color: var(--ink);
}
.jv-help-drawer__prose :deep(h2),
.jv-help-drawer__prose :deep(h3) {
  line-height: 1.25;
  margin-top: 1.4em;
  margin-bottom: 0.5em;
  color: var(--ink);
}
.jv-help-drawer__prose :deep(h2) {
  font-size: 17px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
  padding-bottom: 4px;
}
.jv-help-drawer__prose :deep(h3) {
  font-size: 14px;
  font-weight: 600;
}
.jv-help-drawer__prose :deep(p) { margin: 0 0 0.9em; }
.jv-help-drawer__prose :deep(ul),
.jv-help-drawer__prose :deep(ol) { margin: 0 0 0.9em 1.3em; padding: 0; }
.jv-help-drawer__prose :deep(li) { margin-bottom: 0.3em; }
.jv-help-drawer__prose :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.jv-help-drawer__prose :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--surface-3);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--ink);
}
.jv-help-drawer__prose :deep(pre) {
  background: var(--surface-2);
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--line);
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0 0 0.9em;
}
.jv-help-drawer__prose :deep(pre code) { background: transparent; padding: 0; }
.jv-help-drawer__prose :deep(blockquote) {
  margin: 0 0 0.9em;
  padding: 4px 12px;
  border-left: 3px solid var(--accent);
  color: var(--ink-2);
  font-style: italic;
}
.jv-help-drawer__prose :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 1em;
  font-size: 13px;
}
.jv-help-drawer__prose :deep(th),
.jv-help-drawer__prose :deep(td) {
  border: 1px solid var(--line);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
.jv-help-drawer__prose :deep(th) {
  background: var(--surface-2);
  font-weight: 600;
}
.jv-help-drawer__prose :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 1.5em 0;
}
.jv-help-drawer__prose :deep(strong) { font-weight: 600; }

.jv-help-drawer__empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--ink-3);
  font-size: 13px;
}

.jv-help-drawer__footer {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  border-top: 1px solid var(--line);
  background: var(--surface-2);
  font-size: 11px;
  color: var(--ink-3);
}
.jv-help-drawer__slug code {
  background: transparent;
  padding: 0;
  font-family: var(--font-mono);
}
</style>
