// SPDX-License-Identifier: MIT
//
// Adapted from voicebox (MIT) — backend/mcp_server/resolve.py at the commit pinned in
// voicebox-pin.txt. Voicebox resolves to a VoiceProfile; JustVoice resolves to (voice_id,
// persona) since personas carry the voice binding. Original copyright (c) the voicebox authors.
//
// Voice resolution for MCP tool calls (the port of justvoice/mcp/resolve.py).
//
// Precedence:
//   1. Explicit `voice` tool arg (a JustVoice voice id)
//   2. Explicit `persona` tool arg (persona name or id) → its voice
//   3. Per-client MCPBinding.persona_id → its voice
//   4. settings.mcp.default_voice (global default)
//   5. null — the caller raises a helpful error

import { strip } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { MCPBinding } from "../database/models.js";

export class Resolved {
  /** `persona` is set when the voice came via a persona. */
  constructor(voice_id, persona = null) {
    this.voice_id = voice_id;
    this.persona = persona;
  }
}

function _personaByNameOrId(ref) {
  const personas = getState().personas;
  const p = personas.get(ref);
  if (p != null) return p;
  const want = strip(ref).toLowerCase();
  for (const cand of personas.list()) if (strip(cand.name).toLowerCase() === want) return cand;
  return null;
}

/** Apply the full precedence chain (`h` is the database handle). null when nothing resolves. */
export function resolveVoice(voice, persona, clientId, h) {
  if (voice) return new Resolved(voice, null);

  if (persona) {
    const p = _personaByNameOrId(persona);
    if (p != null && p.voice_id) return new Resolved(p.voice_id, p);
    // Explicit but not found / voiceless — let the caller report it.
    return null;
  }

  if (clientId) {
    const binding = h.one(`select * from ${MCPBinding} where client_id = ? limit 1`, [clientId], MCPBinding);
    if (binding != null && binding.persona_id) {
      const p = getState().personas.get(binding.persona_id);
      if (p != null && p.voice_id) return new Resolved(p.voice_id, p);
    }
  }

  const dflt = getState().settings.get().mcp.default_voice;
  if (dflt) return new Resolved(dflt, null);

  return null;
}
