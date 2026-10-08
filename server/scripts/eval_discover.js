// SPDX-License-Identifier: MIT
// Score the Discover prompt against a sample book — on demand, real model (the port of
// eval_discover.py, 2026-10-08; the conversion leaves no Python).
//
//     npm run eval:discover                      # server on 127.0.0.1:8741
//     npm run eval:discover -- --server http://127.0.0.1:17494 --runs 3
//     npm run eval:discover -- --system candidate.txt   # try a prompt, save nothing
//     npm run eval:discover -- --system s.txt --user u.txt   # a candidate user template too
//
// Needs a running JustVoice server (it owns the model and the LIVE prompt row — AI Settings →
// Features → Find new speakers). Writes nothing: each chapter goes through POST /v1/ai/run,
// the same action Discover runs, then through the same known-list formatting, parser, cast
// filter and quote check the endpoint uses.
//
// The scenario comes from `samples/<sample>/discover-eval.json`: which characters are taken
// out of the cast, which named things are objects, which minor people are real. Scores per
// chapter:
//
//   found      removed characters proposed, of those the chapter names
//   wrong      proposals that are a cast member, a listed object, or an invented quote
//   extra      anyone else — real minor people, or a miss worth reading
//
// Built 2026-09-27 (Discover fix 5) so a prompt edit is measured, not eyeballed.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { B, reEscape } from "@delebash/llm-runner/platform/py";
import { formatKnown, knownLabels, parseCandidates } from "../src/extraction/identify.js";
import { match, norm, quoteInText, refersTo } from "../src/extraction/names.js";
import { runAdapter } from "../src/imports/index.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTION = "speaker_attribution.identify";

async function post(server, route, body, timeoutS = 900) {
  const r = await fetch(server + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutS * 1000),
  });
  if (!r.ok) throw new Error(`${route} -> ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

/** Does the chapter name them — full name, first name, surname, or alias? */
function namedIn(person, text) {
  const words = [person.name, ...(person.aliases || []), ...person.name.split(/\s+/).filter((w) => w.length >= 3)];
  return words.some((w) => new RegExp(`${B}${reEscape(w)}${B}`, "iu").test(text));
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      server: { type: "string", default: "http://127.0.0.1:8741" },
      sample: { type: "string", default: "the-ninth-facet" },
      runs: { type: "string", default: "1" },
      // a file holding a CANDIDATE system prompt to test instead of the live one — the Lab's
      // unsaved-draft door; nothing is saved
      system: { type: "string" },
      // a file holding a CANDIDATE user template ({{…}} variables filled as usual)
      user: { type: "string" },
    },
  });
  const runs = Number.parseInt(args.runs, 10);
  const root = path.join(ROOT, "samples", args.sample);
  const spec = JSON.parse(readFileSync(path.join(root, "discover-eval.json"), "utf8"));
  const book = runAdapter("justwrite", readFileSync(path.join(root, "book.json")), { filename: "book.json" });

  const people = book.characters.map((c) => ({ name: c.name, aliases: c.aliases, description: c.notes }));
  const removed = people.filter((p) => spec.remove_from_cast.includes(p.name));
  const cast = [{ name: "Narrator", aliases: [], description: null }, ...people.filter((p) => !spec.remove_from_cast.includes(p.name))];
  const objects = spec.not_characters || [];
  const extrasOk = new Set((spec.real_extras || []).map(norm));

  const candidate = args.system ? readFileSync(args.system, "utf8") : null;
  const candidateUser = args.user ? readFileSync(args.user, "utf8") : null;
  console.log(
    `Discover prompt test · ${book.project.name} · ${args.server} · ${runs} run(s) per chapter` +
      ` · prompt: ${candidate ? `CANDIDATE ${args.system}` : "live row"}` +
      `${candidateUser ? ` + CANDIDATE user template ${args.user}` : ""}`,
  );
  console.log(`cast: ${cast.map((p) => p.name).join(", ")}`);
  console.log(`taken out of the cast: ${removed.map((p) => p.name).join(", ")}\n`);

  const totals = { expected: 0, found: 0, wrong: 0, quotes: 0, quotes_ok: 0 };
  for (const scene of book.scenes) {
    const text = scene.lines.filter((l) => l.text).map((l) => l.text).join("\n\n");
    const expected = removed.filter((p) => namedIn(p, text));
    for (let run = 0; run < runs; run++) {
      const t0 = Date.now();
      const body = { action: ACTION, variables: { known_speakers: formatKnown(cast), manuscript: text } };
      if (candidate) body.system = candidate;
      if (candidateUser) body.userTemplate = candidateUser;
      const resp = await post(args.server, "/v1/ai/run", body);
      const cands = parseCandidates(resp.content || "", knownLabels(cast));
      const found = [];
      const wrong = [];
      const extra = [];
      for (const c of cands) {
        if (match(c.name, cast) !== null) continue; // the endpoint drops these too — not shown to anyone
        const okQuote = c.evidence ? quoteInText(c.evidence, text) : null;
        if (c.evidence) {
          totals.quotes += 1;
          totals.quotes_ok += okQuote ? 1 : 0;
        }
        const label = `${c.name}${okQuote !== false ? "" : " [invented quote]"}`;
        if (removed.some((p) => refersTo(c.name, p))) found.push(c.name);
        else if (objects.some((o) => norm(c.name) === norm(o) || refersTo(c.name, { name: o }))) wrong.push(`${label} [object]`);
        else if (cast.some((p) => refersTo(c.name, p)) || okQuote === false) wrong.push(label + (okQuote !== false ? " [cast]" : ""));
        else if (extrasOk.has(norm(c.name))) extra.push(`${label} (real)`);
        else extra.push(label);
      }
      const hit = expected.filter((p) => found.some((n) => refersTo(n, p))).map((p) => p.name);
      const missed = expected.map((p) => p.name).filter((n) => !hit.includes(n));
      totals.expected += expected.length;
      totals.found += hit.length;
      totals.wrong += wrong.length;
      const tag = runs > 1 ? ` run ${run + 1}` : "";
      console.log(`## ${scene.title}${tag}  (${text.length.toLocaleString("en-US")} chars, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      console.log(`   found ${hit.length}/${expected.length}${missed.length ? `   MISSED ${missed.join(", ")}` : ""}`);
      if (wrong.length) console.log(`   WRONG  ${wrong.join(", ")}`);
      if (extra.length) console.log(`   extra  ${extra.join(", ")}`);
    }
  }

  console.log(
    `\nrecall ${totals.found}/${totals.expected} · wrong ${totals.wrong} · quotes found in the text ${totals.quotes_ok}/${totals.quotes}`,
  );
  return 0;
}

process.exitCode = await main();
