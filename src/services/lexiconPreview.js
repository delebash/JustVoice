// SPDX-License-Identifier: MIT
//
// Lexicon preview — ONE truth for what a lexicon entry does to a line.
//
// Until 2026-08-21 the previews contradicted each other AND the renderer
// (one IPA-first, one alias-first, the render alias-only). Now the render
// does both (render_core._apply_lexicons; IPA through the speech runtime's
// inline pronunciations, Kokoro only since runtime v0.9.0-jv.4), and the
// previews — Lexicons and a persona's Hear it count — mirror it from here:
//
//   * alias        — replaces the TEXT, case-sensitive substring, on any
//                    engine (render_core: `out.replace(grapheme, alias)`).
//   * phoneme_ipa  — never touches the text; it is the PRONUNCIATION,
//                    matched case-insensitively on word boundaries and
//                    spliced engine-side where phonemes are supported
//                    (kokoro/ipa.py). Previews show it as /ipa/.
//   * both set     — IPA speaks on a phoneme-capable engine, the alias
//                    is the fallback everywhere else, so both facts show.

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How one entry displays in any preview: "alias", "/ipa/", or both. */
export function entryDisplay(entry) {
  const alias = (entry.alias || "").trim();
  const ipa = (entry.phoneme_ipa || "").trim();
  if (alias && ipa) return `${alias} · /${ipa}/`;
  if (ipa) return `/${ipa}/`;
  return alias;
}

/**
 * The entries that affect `text`, for a match table.
 * Longest grapheme first (a multi-word entry beats its own substring),
 * one row per grapheme, counted the way the pronunciation matcher counts
 * (case-insensitive word boundary).
 *
 * `ipa` — does the line's model take IPA? When it doesn't, an IPA-only
 * entry does nothing at render, so it isn't counted, and an entry with both
 * counts as its respelling (decided 2026-10-05: the persona page counted
 * IPA-only entries whatever the voice's model).
 *
 * @returns {Array<{word, display, kind, count}>}
 */
export function lexiconMatches(text, entries, { ipa = true } = {}) {
  if (!text) return [];
  const sorted = [...(entries || [])].sort(
    (a, b) => (b.grapheme?.length || 0) - (a.grapheme?.length || 0),
  );
  const seen = new Set();
  const matches = [];
  for (const e of sorted) {
    if (!e.grapheme) continue;
    const usable = ipa ? e : { ...e, phoneme_ipa: "" };
    const display = entryDisplay(usable);
    if (!display) continue;
    const key = e.grapheme.toLowerCase();
    if (seen.has(key)) continue;
    const found = text.match(new RegExp(`\\b${escapeRe(e.grapheme)}\\b`, "gi"));
    if (!found) continue;
    seen.add(key);
    matches.push({
      word: e.grapheme,
      display,
      kind: usable.phoneme_ipa
        ? (usable.alias ? "spelling + pronunciation" : "pronunciation")
        : "spelling",
      count: found.length,
    });
  }
  return matches;
}

/**
 * The line with every effect marked inline, for a text preview:
 * alias entries replace the word with 「alias」 (the render's own
 * case-sensitive substring rule); IPA-only entries keep the word and
 * append 「/ipa/」 after it (the text is not replaced at render either).
 */
export function previewLexiconText(text, entries) {
  if (!text) return "";
  const sorted = [...(entries || [])].sort(
    (a, b) => (b.grapheme?.length || 0) - (a.grapheme?.length || 0),
  );
  let out = text;
  for (const e of sorted) {
    if (!e.grapheme) continue;
    const alias = (e.alias || "").trim();
    const ipa = (e.phoneme_ipa || "").trim();
    const escaped = escapeRe(e.grapheme);
    if (alias) {
      const marker = ipa ? `「${alias} · /${ipa}/」` : `「${alias}」`;
      out = out.split(e.grapheme).join(marker);
    } else if (ipa) {
      out = out.replace(
        new RegExp(`\\b(${escaped})\\b`, "gi"),
        `$1「/${ipa}/」`,
      );
    }
  }
  return out;
}
