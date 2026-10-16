// SPDX-License-Identifier: MIT
// What the voices-from-the-book step reads of a book (book_voices/index.js): the book in reading
// order, each recipe's text for the model, and the line each voice's audition speaks.
//
// A chapter's lines are read in their order, grouped into the paragraphs they were cut from — the
// lines of one paragraph share `paragraph_idx` in their metadata, and a line with none is a
// paragraph of its own (the rule segmentation.segmentsFromLines reads).

import { splitWs, strip } from "@delebash/llm-runner/platform/py";
import { jsonLoads } from "@delebash/llm-runner/platform/pyjson";
import { Block, Scene } from "../database/models.js";
import { spokenBlock } from "../extraction/flags.js";
import { stripMarks } from "../extraction/segmentation.js";

export const wordCount = (text) => splitWs(text || "").length;

function paragraphIdx(block) {
  if (!block.metadata_json) return null;
  try {
    const meta = jsonLoads(block.metadata_json);
    const idx = meta && typeof meta === "object" ? meta.paragraph_idx : null;
    return idx ?? null;
  } catch {
    return null;
  }
}

/** The book in reading order → [{id, title, paragraphs: [[line, …], …]}]; lines with no words
 * left out. */
export function bookChapters(h, projectId) {
  const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
  return scenes.map((scene) => {
    const lines = h
      .all(`select * from ${Block} where scene_id = ? order by position`, [scene.id], Block)
      .filter((b) => strip(b.text || ""));
    const paragraphs = [];
    let prev = Symbol("none");
    for (const b of lines) {
      const para = paragraphIdx(b);
      if (para === null || para !== prev) paragraphs.push([]);
      prev = para;
      paragraphs.at(-1).push(b);
    }
    return { id: scene.id, title: strip(scene.title || ""), paragraphs };
  });
}

/**
 * The Local recipe's reading for one speaker: every paragraph with one of their lines, in book
 * order, their own lines marked ⟦ ⟧ — until `budget` words (the first paragraph always, so a
 * speaker is never sent nothing). The earliest come first: a book shows a speaker when they enter.
 */
export function speakerPassages(chapters, speakerId, budget) {
  const out = [];
  let words = 0;
  for (const chapter of chapters) {
    for (const para of chapter.paragraphs) {
      if (!para.some((b) => b.speaker_id === speakerId)) continue;
      const text = para.map((b) => (b.speaker_id === speakerId ? `⟦${strip(b.text)}⟧` : strip(b.text))).join(" ");
      const n = wordCount(text);
      if (out.length && words + n > budget) return out.join("\n\n");
      out.push(text);
      words += n;
    }
  }
  return out.join("\n\n");
}

/** The Local recipe's narrator reading: the book's opening, whole paragraphs up to `budget` words
 * (the first always). */
export function bookOpening(chapters, budget) {
  const out = [];
  let words = 0;
  for (const chapter of chapters) {
    for (const para of chapter.paragraphs) {
      const text = para.map((b) => strip(b.text)).join(" ");
      const n = wordCount(text);
      if (out.length && words + n > budget) return out.join("\n\n");
      out.push(text);
      words += n;
    }
  }
  return out.join("\n\n");
}

/** The Frontier recipe's reading: the whole book, each chapter under its title, each spoken line
 * after its speaker's name in brackets. `nameOf`: Map speaker id → name. */
export function bookManuscript(chapters, nameOf) {
  return chapters
    .map((chapter) => {
      const paras = chapter.paragraphs.map((para) =>
        para
          .map((b) => {
            const name = b.speaker_id && spokenBlock(b.source, b.text) ? nameOf.get(b.speaker_id) : null;
            return name ? `[${name}] ${strip(b.text)}` : strip(b.text);
          })
          .join(" "),
      );
      return [chapter.title ? `## ${chapter.title}` : null, ...paras].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The line a voice's audition speaks — the words its clip keeps: one of the speaker's own lines
 * (the narrator's: a narration line), its speech marks off, of at least half `target` words, the
 * one nearest `target` among those with no "!" (the clip should be calm — its delivery carries
 * into every line, the plan's §13), else among all. null when the speaker has no line that long —
 * the caller then speaks a stock line.
 */
export function auditionLine(chapters, speakerId, target, { narration = false } = {}) {
  const lines = [];
  for (const chapter of chapters) {
    for (const para of chapter.paragraphs) {
      for (const b of para) {
        if (b.speaker_id !== speakerId) continue;
        if (narration && spokenBlock(b.source, b.text)) continue;
        const text = stripMarks(b.text);
        if (text) lines.push(text);
      }
    }
  }
  const nearest = (pool) => {
    let best = null;
    for (const text of pool) {
      const gap = Math.abs(wordCount(text) - target);
      if (best === null || gap < best.gap) best = { text, gap };
    }
    return best?.text ?? null;
  };
  const long = lines.filter((t) => wordCount(t) * 2 >= target);
  return nearest(long.filter((t) => !t.includes("!"))) ?? nearest(long);
}
