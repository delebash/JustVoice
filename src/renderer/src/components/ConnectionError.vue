<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
// Shown in place of the whole app when the JustVoice server can't be reached at
// boot. The renderer holds no data of its own, so rather than render empty
// stores (which look broken and silently fail to save), we surface a clear
// error + retry.
import { SERVER_URL } from "../config.js";
const isDev = import.meta.env.DEV;
function retry() { location.reload(); }
</script>

<template>
  <div class="conn-err">
    <div class="conn-err__card">
      <div class="conn-err__icon">⚠️</div>
      <h1>Can't reach the JustVoice server</h1>
      <p>
        JustVoice needs its server to load voices, projects, and settings. It
        isn't responding at <code>{{ SERVER_URL }}</code>.
      </p>
      <p v-if="isDev" class="conn-err__hint">
        Dev: it should start automatically with <code>npm run tauri dev</code>, or
        run it yourself with <code>npm run server</code>, then retry.
      </p>
      <button class="conn-err__btn" type="button" @click="retry">Retry</button>
    </div>
  </div>
</template>

<style scoped>
.conn-err { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg, #f7f5f0); padding: 24px; }
.conn-err__card { max-width: 460px; text-align: center; background: var(--surface, #fff); border: 1px solid var(--border, #e6e1d8); border-radius: 14px; padding: 32px 28px; box-shadow: 0 8px 30px rgba(0,0,0,.06); }
.conn-err__icon { font-size: 34px; line-height: 1; }
.conn-err__card h1 { font-size: 18px; margin: 14px 0 8px; color: var(--text, #2b2620); }
.conn-err__card p { color: var(--text-muted, #6b6357); font-size: 13.5px; line-height: 1.55; margin: 0 0 10px; }
.conn-err__hint { font-size: 12.5px; }
.conn-err code { background: var(--surface-2, #f0ece4); padding: 1px 6px; border-radius: 5px; font-size: 12px; }
.conn-err__btn { margin-top: 16px; padding: 9px 22px; border: 0; border-radius: 8px; background: var(--accent, hsl(158 55% 36%)); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.conn-err__btn:hover { filter: brightness(1.06); }
</style>
