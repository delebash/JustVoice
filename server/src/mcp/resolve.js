// SPDX-License-Identifier: MIT
// Which voice a `justvoice.speak` call speaks with. First match wins:
//
//   1. the call's `voice` (a voice id) — even when a persona is named too;
//   2. the call's `persona` — by id, else by name (trimmed, any case). A persona that is not
//      found, or has no voice, resolves NOTHING: the caller asked for it by name, so falling
//      back to someone else's voice would be wrong;
//   3. the calling client's binding (Settings → MCP), when its persona exists and has a voice;
//   4. `settings.mcp.default_voice`;
//   5. nothing (null) — speak then tells the caller its four ways out.
//
// Empty strings count as not given.

import { strip } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { MCPBinding } from "../database/models.js";

const given = (v) => (typeof v === "string" ? strip(v) : "") !== "";

/** A persona by id, else by name (trimmed, case-insensitive). */
function findPersona(personas, ref) {
  const byId = personas.get(ref);
  if (byId) return byId;
  const want = strip(ref).toLowerCase();
  return personas.list().find((p) => strip(p.name ?? "").toLowerCase() === want) ?? null;
}

/** `{voice_id, persona}` for this call, or null when nothing resolves. `h` is the database
 * handle the client bindings are read through. */
export function resolveVoice(voice, persona, clientId, h) {
  if (given(voice)) return { voice_id: voice, persona: null };

  const st = getState();
  if (given(persona)) {
    const p = findPersona(st.personas, persona);
    return p?.voice_id ? { voice_id: p.voice_id, persona: p } : null;
  }

  if (given(clientId)) {
    const binding = h.get(MCPBinding, clientId);
    const bound = binding?.persona_id ? st.personas.get(binding.persona_id) : null;
    if (bound?.voice_id) return { voice_id: bound.voice_id, persona: bound };
  }

  const fallback = st.settings.get().mcp?.default_voice;
  return given(fallback) ? { voice_id: fallback, persona: null } : null;
}
