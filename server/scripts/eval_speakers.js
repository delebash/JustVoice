// SPDX-License-Identifier: MIT
// Score the one-click plan's slice 4 against an answer key — Discover on every keyed chapter, the
// names merged across chapters, the people added, Analyze, then the lines with no single speaker
// given out — through a running server's own routes, the way the one-click run will take them.
//
//     npm run eval:speakers                                  # server on 127.0.0.1:8741, Alice
//     npm run eval:speakers -- --server http://127.0.0.1:17494
//     npm run eval:speakers -- --keep                        # keep the book to look at in Studio
//
// The slice's acceptance (docs/plans/2026-10-11-one-click-audiobook.md §10, item 4), on Alice
// VII–VIII: "one Queen, no one with 0 lines becomes a speaker, and 'No room!' goes to the Hatter
// or the March Hare, flagged." What it prints:
//
//   people     each person the merge made — their names, Discover's line count — and, against
//              the key, every keyed speaker found ONCE (twice = a missed merge; one person who is
//              two of the key's = a wrong merge), anyone left out who speaks (LOST), and anyone
//              added who speaks no keyed line (Discover's count, not the text's)
//   lines      every keyed line right / WRONG / blank, as eval:attribution scores them
//   group      every line the key gives no single speaker: who it went to, whether that is one of
//              the group the key names (`groups`; the narrator when it names none of the cast),
//              and whether Script marks it "group"
//
// Unlike eval:discover and eval:attribution it WRITES: it imports the sample's keyed chapters as a
// new book on that server (its data folder) and deletes the book at the end unless --keep. The
// model and the prompts are the server's live ones (AI Settings → Features: Find new speakers,
// Merge found names, Speaker attribution, … lines with no single speaker).
//
// Built 2026-10-16 with slice 4; run on gemma when the graphics card is free.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { bare } from "../src/extraction/names.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

class Exit extends Error {}

async function call(server, method, route, { json = undefined, form = undefined, timeoutS = 1800 } = {}) {
  const init = { method, signal: AbortSignal.timeout(timeoutS * 1000) };
  if (json !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(json);
  } else if (form !== undefined) init.body = form;
  const r = await fetch(server + route, init);
  const text = await r.text();
  if (!r.ok) throw new Exit(`${method} ${route} -> ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const tokens = (u) => (u ? `${u.prompt_tokens ?? 0} in / ${u.completion_tokens ?? 0} out${u.model ? `, ${u.model}` : ""}` : "no model call");

async function main() {
  const { values: args } = parseArgs({
    options: {
      server: { type: "string", default: "http://127.0.0.1:8741" },
      sample: { type: "string", default: "alice-in-wonderland" },
      keep: { type: "boolean" }, // keep the book on the server afterwards
    },
  });
  const server = args.server.replace(/\/+$/, "");
  const root = path.join(ROOT, "server", "samples", args.sample);
  const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
  const keyed = Object.keys(key.chapters);
  const cast = key.cast.map((c) => (typeof c === "object" && c !== null ? c : { name: c, aliases: [] }));
  const labels = (x) => [x.name, ...(x.aliases || [])].map(bare);
  /** The key's cast member a person or speaker is — one of its names is one of theirs. */
  const keyOf = (x) => cast.filter((k) => labels(k).some((l) => labels(x).includes(l))).map((k) => k.name);
  const spokenInKey = new Set(Object.values(key.chapters).flatMap((m) => Object.values(m)));

  console.log(`Speakers test (one-click slice 4) · ${key.title || args.sample} · ${server}\n`);

  // 1 · Import the keyed chapters as a new book.
  const bookFile = key.book || "book.json";
  const raw = readFileSync(path.join(root, bookFile));
  let pid;
  if (key.adapter && key.adapter !== "justwrite") {
    const form = (extra) => {
      const f = new FormData();
      f.set("source", key.adapter);
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      f.set("file", new Blob([raw]), bookFile);
      return f;
    };
    const dry = await call(server, "POST", "/v1/projects/import", { form: form({ dry_run: "true" }) });
    const keep = dry.standard.scenes.flatMap((s, i) => (keyed.includes(s.title) ? [i] : []));
    if (keep.length !== keyed.length) throw new Exit(`the book has ${keep.length} of the key's ${keyed.length} chapters`);
    pid = (await call(server, "POST", "/v1/projects/import", { form: form({ include_scenes: keep.join(","), name: `${key.title || args.sample} (eval:speakers)` }) })).project_id;
  } else {
    const r = await fetch(`${server}/v1/projects/import?source=justwrite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw });
    if (!r.ok) throw new Exit(`import -> ${r.status}: ${(await r.text()).slice(0, 400)}`);
    pid = (await r.json()).project_id;
  }
  console.log(`book ${pid}${args.keep ? " (kept)" : ""}`);
  try {
    const scenes = (await call(server, "GET", `/v1/projects/${pid}/scenes`)).filter((s) => keyed.includes(s.title));
    await call(server, "POST", `/v1/projects/${pid}/narrator`);
    const texts = {};
    for (const s of scenes) {
      texts[s.id] = (await call(server, "GET", `/v1/scenes/${s.id}/blocks`))
        .map((b) => b.text)
        .filter(Boolean)
        .join("\n\n");
    }

    // 2 · Discover each chapter.
    for (const s of scenes) {
      const t0 = Date.now();
      const r = await call(server, "POST", `/v1/scenes/${s.id}/discover-speakers`, { json: { text: texts[s.id] } });
      console.log(`discover · ${s.title}: ${r.candidates.map((c) => `${c.name} ${c.approx_lines ?? "?"}`).join(", ")}  (${secs(t0)}, ${tokens(r.usage)})`);
    }

    // The names merged across chapters.
    let t0 = Date.now();
    const merged = await call(server, "POST", `/v1/projects/${pid}/speakers/merge`);
    console.log(`\nmerge · recipe ${merged.recipe} (${secs(t0)}, ${tokens(merged.usage)})`);
    for (const p of merged.people) console.log(`   ${p.name}${p.aliases.length ? ` (also ${p.aliases.join(", ")})` : ""} — ${p.lines ?? "?"} line(s)`);
    if (merged.left_out.length) console.log(`   left out, 0 lines: ${merged.left_out.map((p) => p.name).join(", ")}`);
    if (merged.in_book.length) console.log(`   already in the book: ${merged.in_book.map((x) => x.name).join(", ")}`);
    const problems = [];
    for (const k of cast.filter((k) => spokenInKey.has(k.name))) {
      const hits = merged.people.filter((p) => keyOf(p).includes(k.name));
      if (hits.length > 1) problems.push(`MISSED MERGE ${k.name}: ${hits.map((p) => p.name).join(" + ")}`);
      if (!hits.length) {
        const lost = merged.left_out.filter((p) => keyOf(p).includes(k.name));
        problems.push(lost.length ? `LOST ${k.name} (left out with 0 lines as ${lost.map((p) => p.name).join(", ")})` : `MISSING ${k.name}`);
      }
    }
    for (const p of merged.people) {
      const ks = keyOf(p);
      if (ks.length > 1) problems.push(`WRONG MERGE ${p.name}: ${ks.join(" + ")}`);
      else if (!ks.some((k) => spokenInKey.has(k))) problems.push(`no keyed line: ${p.name} (Discover counted ${p.lines ?? "?"})`);
    }
    console.log(problems.length ? problems.map((x) => `   ${x}`).join("\n") : "   every keyed speaker once, no one added without a line");

    // 3 · Add them.
    await call(server, "POST", `/v1/projects/${pid}/speakers/promote`, {
      json: { candidates: merged.people.map((p) => ({ name: p.name, description: p.description, aliases: p.aliases })) },
    });

    // 4 · Analyze each chapter; then the lines with no single speaker.
    console.log("");
    const given = {};
    for (const s of scenes) {
      t0 = Date.now();
      const a = await call(server, "POST", `/v1/scenes/${s.id}/analyze`, { json: { text: texts[s.id] } });
      const t1 = Date.now();
      given[s.id] = await call(server, "POST", `/v1/scenes/${s.id}/group-lines`);
      const g = given[s.id];
      console.log(
        `analyze · ${s.title}: route ${a.route_used} (${((t1 - t0) / 1000).toFixed(0)}s, ${tokens(a.usage)}) · ` +
          `no single speaker: ${g.asked} asked, ${g.given} to one of a group, ${g.to_narrator} to the narrator, ${g.left} left, ${g.failed} failed (${secs(t1)}, ${tokens(g.usage)})`,
      );
    }

    // Score what Script shows.
    const speakers = (await call(server, "GET", `/v1/projects/${pid}/speakers`)).speakers;
    const nameOf = new Map(speakers.map((sp) => [sp.id, sp.role_label === "narrator" ? "Narrator" : (keyOf(sp)[0] ?? sp.name)]));
    const total = { right: 0, WRONG: 0, blank: 0, group_right: 0, group_flagged: 0, group_n: 0 };
    for (const s of scenes) {
      const page = await call(server, "GET", `/v1/scenes/${s.id}/script`);
      const lines = page.lines.filter((l) => l.spoken);
      const truth = key.chapters[s.title];
      if (lines.length !== Object.keys(truth).length) console.log(`   ${lines.length} spoken lines, key has ${Object.keys(truth).length} — the numbering is off`);
      const c = { right: 0, WRONG: 0, blank: 0 };
      const errors = [];
      const groupRows = [];
      for (const [d, want] of Object.entries(truth)) {
        const line = lines[Number(d)];
        if (!line) continue;
        const got = line.speaker_id ? nameOf.get(line.speaker_id) : "unknown";
        if (want === "unknown") {
          const group = key.groups?.[s.title]?.[d];
          const flagged = (line.flags || []).some((f) => page.flag_groups[f]?.check === "group");
          const ok = group === undefined ? null : group.length ? group.includes(got) : got === "Narrator";
          total.group_n += 1;
          if (ok) total.group_right += 1;
          if (flagged) total.group_flagged += 1;
          groupRows.push(`D${d} ${ok === null ? "(no group in the key)" : ok ? "right" : "WRONG"} → ${got}${flagged ? ", flagged" : ", NOT flagged"}  ${line.text.slice(0, 60)}`);
          continue;
        }
        const verdict = got === want ? "right" : got === "unknown" ? "blank" : "WRONG";
        c[verdict] += 1;
        if (verdict !== "right") errors.push(`D${d} ${verdict.padEnd(5)} want ${want.padEnd(15)} got ${got}  [${line.source}]  ${line.text.slice(0, 60)}`);
      }
      for (const k of Object.keys(c)) total[k] += c[k];
      const n = c.right + c.WRONG + c.blank;
      console.log(`## ${s.title}  right ${c.right}/${n}  WRONG ${c.WRONG}  blank ${c.blank}`);
      for (const e of errors) console.log(`   ${e}`);
      for (const g of groupRows) console.log(`   group ${g}`);
    }
    const n = total.right + total.WRONG + total.blank;
    console.log(
      `\nTOTAL lines right ${total.right}/${n} · WRONG ${total.WRONG} · blank ${total.blank} · ` +
        `no single speaker: ${total.group_right}/${total.group_n} to the key's group, ${total.group_flagged}/${total.group_n} flagged · ` +
        `merge: ${problems.length ? `${problems.length} problem(s)` : "clean"}`,
    );
  } finally {
    if (!args.keep) await call(server, "DELETE", `/v1/projects/${pid}`);
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (!(e instanceof Exit)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
