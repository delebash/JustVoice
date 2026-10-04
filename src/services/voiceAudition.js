// SPDX-License-Identifier: MIT
//
// Hear a voice on its own — the ▶ beside a voice anywhere but the Voices
// table (which streams). One door, so the ask-before-load contract is the
// same everywhere: a play never loads a model behind your back unless you
// chose "Always auto-load" (the pref the Voices page shares).
//
// Returns the WAV Blob, or null when you declined the load. Throws what the
// server said otherwise (the caller runs handleTermsRefusal first).

import { confirmDialog, pushToast } from "@delebash/llm-ui";
import { readPref, writePref } from "./prefs.js";

export async function auditionVoice(api, voice) {
  const always = readPref("autoLoadEngine") === "always";
  try {
    return await api.request(`/v1/voices/${voice.id}/preview?auto_load=${always}`, { method: "POST" });
  } catch (e) {
    const m = String(e?.message || "").match(/engine_not_loaded:([\w.-]+)/);
    if (!m) throw e;
    const engineId = m[1];
    const name = voice.model_name || engineId;
    const ok = await confirmDialog({
      title: `Load ${name}?`,
      message: `"${voice.name}" speaks on ${name}, which isn't loaded. Load it now to hear it? The first load can take up to a minute; after that it plays at once.`,
      confirmLabel: "Load & play",
    });
    if (!ok) return null;
    pushToast({ message: `Loading ${name}… this can take up to a minute.`, kind: "info" });
    const blob = await api.request(`/v1/voices/${voice.id}/preview?auto_load=true`, { method: "POST" });
    pushToast({
      message: `${name} loaded.`,
      kind: "success",
      action: { label: "Always auto-load", fn: () => writePref("autoLoadEngine", "always") },
    });
    // The topbar pill and the Engines page track loads from anywhere.
    window.dispatchEvent(new Event("jv:health-refresh"));
    return blob;
  }
}
