// Which import adapter a dropped file belongs to.
//
// Extension alone cannot answer this — three adapters claim `.txt`
// (book_prose, podcast_markdown, audacity_labels) and two claim `.json`
// (justwrite, justvoice_standard). Before this module the picker read the
// extension, then sniffed ONLY for podcast speaker labels, so everything else
// fell through to the first registry match: an Audacity label track imported as
// prose, and a JustVoice standard payload was handed to the JustWrite adapter.
//
// So each ambiguous format gets a probe against the file's first bytes, ordered
// most-specific first. A probe only runs when its adapter is actually a
// candidate for this extension, which keeps the rules independent of registry
// order. No probe matching is a normal outcome, not a failure — the fallback
// still returns something sensible.
//
// Pure and dependency-free on purpose: this is the part worth unit-testing, and
// it should not need a mounted component to test.

// `SARAH:` / `**JIN:**` / `[HOST]:` at the start of a line — a script, not prose.
const SPEAKER_LABEL_RE = /^\s*(?:\*\*|\[)?[A-Z][A-Za-z0-9 .'-]{0,40}?(?:\]|\*\*)?\s*:/m;

// An Audacity label row is tab-separated and starts with a timestamp:
// `0.000000\t4.250000\tFirst label` (or the two-column point-label form).
const AUDACITY_ROW_RE = /^[ \t]*-?\d+(?:\.\d+)?\t/m;

// A JustWrite book.json always carries the chapter tree and the scene map.
const JUSTWRITE_JSON_RE = /"(?:parts|scenes)"\s*:/;

// A payload already in JustVoice's own shape announces its schema.
const JUSTVOICE_JSON_RE = /"(?:schema_version|lexicon_entries)"\s*:/;

const PROBES = [
  { id: "audacity_labels", matches: (head) => AUDACITY_ROW_RE.test(head) },
  { id: "podcast_markdown", matches: (head) => SPEAKER_LABEL_RE.test(head) },
  { id: "justvoice_standard", matches: (head) => JUSTVOICE_JSON_RE.test(head) },
  { id: "justwrite", matches: (head) => JUSTWRITE_JSON_RE.test(head) },
];

/**
 * @param {object} args
 * @param {string} args.ext        lower-case extension including the dot, e.g. ".txt"
 * @param {string} args.head       the file's first few KB as text ("" if unreadable)
 * @param {Array}  args.adapters   the /v1/projects/import/adapters list
 * @returns {object|null} the chosen adapter, or null when the extension fits none
 */
export function pickAdapter({ ext, head = "", adapters = [] }) {
  const candidates = adapters.filter(
    (a) => a.implemented && (a.file_extensions || []).includes(ext)
  );
  if (candidates.length <= 1) return candidates[0] || null;

  for (const probe of PROBES) {
    const candidate = candidates.find((a) => a.id === probe.id);
    if (candidate && probe.matches(head)) return candidate;
  }

  // Nothing identified it. Never fall back to the speaker-labeled-script
  // adapter: a plain book would import as one long speakerless segment under a
  // format that promises speakers.
  return candidates.find((a) => a.id !== "podcast_markdown") || candidates[0];
}

export const _internals = { SPEAKER_LABEL_RE, AUDACITY_ROW_RE };
