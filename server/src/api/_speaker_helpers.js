// SPDX-License-Identifier: MIT
// The people in a book — speakers (decided 2026-09-29) (the port of
// justvoice/api/_speaker_helpers.py).
//
// A speaker is a person in one book: a name, the other names the text uses and who they are.
// Cast gives each speaker a persona — the finished voice, from the library — and one persona
// can play many speakers. A line's voice is line → speaker → persona (`personaForBlock`).
//
// PARTIAL — the render wave (wave C) ported only `personaForBlock`, which render_jobs and
// export_voicelines read. The API wave fills in the rest of this file (sameName,
// cleanAliases, speakerNamed, refuseSameName, personaNamed, speakerLineCounts,
// narratorSpeakerId, …) under the same names.

import { Persona, Speaker } from "../database/models.js";

/** The persona row that voices a line: line → speaker → persona. null when the line has no
 * speaker, or its speaker has no persona yet. `h` is the database handle. */
export function personaForBlock(h, block) {
  if (!block?.speaker_id) return null;
  const speaker = h.get(Speaker, block.speaker_id);
  if (speaker === null || !speaker.persona_id) return null;
  return h.get(Persona, speaker.persona_id);
}
