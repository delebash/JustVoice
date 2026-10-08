// SPDX-License-Identifier: MIT
// The import parity check (wave D of step 5, check a): Python's imports/ and this port read the
// SAME files and must agree on everything.
//
//   1. the inputs: every real book file in JustVoice and JustWrite (the samples, JustWrite's
//      exported zip, EPUB and DOCX), a FRESH export of every book in JustWrite's own database
//      made with JustWrite's own Node export code (book_io.assemble → externalizeImages → the
//      zip its route writes; a COPY of justwrite.db — the real one is never opened), the test
//      fixtures, and a corpus of hard cases built here (entities, CDATA, comments, scripts,
//      malformed markup, bad UTF-8, BOMs, CRLF and lone CR, quoted CSV with line breaks, bad
//      zips, malformed OPF and DOCX XML, standard JSON with every pydantic error kind);
//   2. every input through EVERY adapter (and book_prose through every split mode): the
//      StandardImport — or the error's status and words — compared value for value, key order
//      included; the dry-run preview POST /v1/projects/import answers (Python's real route vs
//      the same response model built here — the route is the API wave's);
//   3. the real books and the fixtures imported into two COPIES of the dev database
//      (`_materializeStandard` + `_materializeLexicon` + one commit, the endpoint's core) and
//      every row of projects, speakers, scenes, blocks, lexicons and lexicon_entries compared
//      cell by cell as SQLite holds it (`quote()`), ids and times aside;
//   4. `htmlBlocks` over every XHTML document in the EPUBs, every JustWrite scene body, the repo's
//      HTML page and the hard-case corpus.
//
//   node scripts/node24.mjs server/scripts/compare-imports.mjs      (JV_PYTHON overrides)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, compare, dataCopy, HERE, PY, REPO, SERVER, tempRoot } from "./compare-render-lib.mjs";

const dir = tempRoot("jv-compare-imports-");
const JW = join(REPO, "..", "justwrite-app");
let exitCode = 0;

try {
  const { ZipReader, ZipWriter } = await import("@delebash/llm-runner/platform/zip");
  const inputsDir = join(dir, "inputs");
  mkdirSync(inputsDir);
  const inputs = []; // [{name, path, kind}]
  const add = (name, bytes, kind) => {
    const p = join(inputsDir, `${String(inputs.length).padStart(3, "0")}-${name.replace(/[^A-Za-z0-9._-]+/g, "_")}`);
    writeFileSync(p, bytes);
    inputs.push({ name, path: p, kind });
  };
  const addFile = (src, kind) => add(src.split(/[\\/]/).pop(), readFileSync(src), kind);

  // ── 1a. real files ──
  for (const f of [
    join(REPO, "samples", "the-ninth-facet", "book.json"),
    join(REPO, "samples", "the-salt-iron-road", "book.json"),
    join(REPO, "samples", "the-speckled-band", "book.txt"),
    join(REPO, "samples", "the-ninth-facet", "attribution-truth.json"),
    join(REPO, "samples", "the-ninth-facet", "discover-eval.json"),
    join(REPO, "legacy-gui", "mockups.html"),
    join(JW, "data", "The Ninth Facet.zip"),
    join(JW, "data", "samples", "The Salt-Iron Road.zip"),
    join(JW, "data", "the-ninth-facet.epub"),
    join(JW, "data", "the-ninth-facet.docx"),
  ]) {
    if (existsSync(f)) addFile(f, "real");
    else console.log(`  (missing, skipped: ${f})`);
  }
  const benchRoot = join(JW, "bench", "results", "desktop-rtx-2070s", "bench");
  const seenBench = new Set();
  for (const d of existsSync(benchRoot) ? readdirSync(benchRoot) : []) {
    const f = join(benchRoot, d, "book.json");
    if (!existsSync(f)) continue;
    const t = readFileSync(f, "utf8");
    if (seenBench.has(t)) continue;
    seenBench.add(t);
    add(`bench-${d}-book.json`, Buffer.from(t), "real");
  }

  // ── 1b. fresh JustWrite exports, made by JustWrite's own Node code from a COPY of its db ──
  const jwData = join(dir, "jw-data");
  mkdirSync(jwData);
  copyFileSync(join(JW, "data", "justwrite.db"), join(jwData, "justwrite.db"));
  const jwSession = await import(new URL(`file:///${join(JW, "server", "src", "database", "session.js").replaceAll("\\", "/")}`).href);
  const jwBookIo = await import(new URL(`file:///${join(JW, "server", "src", "book_io.js").replaceAll("\\", "/")}`).href);
  const jwTransfer = await import(new URL(`file:///${join(JW, "server", "src", "api", "book_transfer_api.js").replaceAll("\\", "/")}`).href);
  const { pyJson } = await import("@delebash/llm-runner/platform/pyjson");
  const jh = jwSession.initDb(jwData);
  let exported = 0;
  for (const { id } of jh.all("select id from projects order by rowid")) {
    const assembled = jwBookIo.assemble(jh, id);
    if (assembled === null) continue;
    const [snap, files] = jwBookIo.externalizeImages(jh, assembled);
    const folder = jwTransfer.safeTitle(snap?.project?.title || "book");
    const zw = new ZipWriter();
    zw.writestr(`${folder}/book.json`, pyJson(snap, { ensureAscii: false, indent: 2 }));
    for (const [fname, raw] of files) zw.writestr(`${folder}/images/${fname}`, raw);
    add(`jw-export-${folder}.zip`, zw.toBuffer(), "real");
    exported += 1;
  }
  jh.close();
  console.log(`inputs: ${inputs.length} files so far (${exported} fresh JustWrite exports)`);

  // ── 1c. the test fixtures and the hard cases ──
  const zip = (entries) => {
    const z = new ZipWriter();
    for (const [n, b] of entries) z.writestr(n, b);
    return z.toBuffer();
  };
  const CONTAINER = (opf = "OEBPS/content.opf") =>
    `<?xml version="1.0"?>\n<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">\n  <rootfiles><rootfile full-path="${opf}" media-type="application/oebps-package+xml"/></rootfiles>\n</container>`;
  const opf = (items, { title = "The Ninth Facet", creator = "Tamsin Vale", lang = "en", extra = "" } = {}) =>
    `<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>${title}</dc:title>\n    <dc:creator>${creator}</dc:creator>\n    <dc:language>${lang}</dc:language>\n  </metadata>\n  <manifest>${items
      .map(([id, href, media = "application/xhtml+xml", props = ""]) => `<item id="${id}" href="${href}" media-type="${media}"${props ? ` properties="${props}"` : ""}/>`)
      .join("\n")}${extra}</manifest>\n  <spine>${items.map(([id]) => `<itemref idref="${id}"/>`).join("\n")}</spine>\n</package>`;
  const xhtml = (title, paras) => `<html><head><title>x</title></head><body>${title ? `<h1>${title}</h1>` : ""}${paras.map((p) => `<p>${p}</p>`).join("")}</body></html>`;
  const epub = (docs, o = {}) =>
    zip([
      ["mimetype", "application/epub+zip"],
      ["META-INF/container.xml", CONTAINER()],
      ["OEBPS/content.opf", o.opfText ?? opf(Object.keys(docs).map((h, i) => [`d${i}`, h]), o)],
      ...Object.entries(docs).map(([h, c]) => [`OEBPS/${h}`, c]),
    ]);
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const docxPara = (t, s) => `<w:p>${s ? `<w:pPr><w:pStyle w:val="${s}"/></w:pPr>` : ""}<w:r><w:t>${t}</w:t></w:r></w:p>`;
  const docx = (paras, title = null, { raw = null } = {}) =>
    zip([
      ["word/document.xml", raw ?? `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paras.map(([t, s]) => docxPara(t, s)).join("")}</w:body></w:document>`],
      ...(title
        ? [
            [
              "docProps/core.xml",
              `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></cp:coreProperties>`,
            ],
          ]
        : []),
    ]);
  const T = (s) => Buffer.from(s, "utf8");

  // HTML hard cases (also fed to htmlBlocks directly).
  const HTML_CASES = [
    "<p>Plain &amp; simple &mdash; &nbsp;spaced&#8212;dashed &#x2014; &copy &ampx &lt;3 &unknown; &#0; &#xD800; &#x110000; &#128512;</p>",
    "<P CLASS='Lead'>Upper <B>case</B><BR/>tags</P><p class=\"scene-mark other\">* * *</p><p class=scene-mark>x</p>",
    "<p>Before<!-- a comment <p>inside</p> -->after</p><p><![CDATA[cdata text]]>tail</p>",
    "<p>Script <script>var x = '<p>nope</p>';</script>after <style>p{}</style>end</p>",
    "<p>unclosed paragraph<p>second<li>item<blockquote>quote</blockquote>",
    "<h1>Title</h1><h2>Sub &amp; title</h2><h3>Third</h3><h4>Fourth</h4><p>Para</p>",
    "<p>a <span title=\"x &quot;y&quot;\">b</span> c</p><p>  lots   of\n\n  space\t\there  </p>",
    "<div><p>in div</p>loose text<p>next</p></div>",
    "<p>x < y and a<b > c</p><p>5 &lt; 6 <3</p>",
    "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body><p>doc</p></body></html>",
    "<?xml version='1.0'?><p>pi first</p><?php echo 1; ?>",
    "<p>ends with an ampersand &amp",
    "<p>ends inside a tag <b",
    "<p>ends inside a comment <!-- never",
    "<p>a</p></div></p><p>b</p>",
    "<p>entities without semicolons &amp &lt &gt &quot &nbspx &notin &notit</p>",
    "<p>Line<br>break<br/>and<br />more</p>",
    "<p>tab\tand\u00a0nbsp\u2003em space</p>",
    "<p>emoji 😀 and combining é</p>",
    "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>",
    "<p>bogus <!x> and </ > and </3> and <!-- -- --></p>",
    "<p><a href=\"x?a=1&b=2\">link</a></p><p>&#X41;&#65;&#x41</p>",
    "",
    "no tags at all &amp; text",
    "<p>a</p><hr><p>b</p><hr/>",
  ];
  const HTML_CASE_DOCS = Object.fromEntries(HTML_CASES.map((h, i) => [`hard${i}.xhtml`, `<html><body><h2>Hard ${i}</h2>${h}<p>Filler so the document is not front matter at all here.</p></body></html>`]));

  add("fixture-epub-spine.epub", epub({ "title.xhtml": xhtml(null, ["The Ninth Facet. By Tamsin Vale."]), "ch1.xhtml": xhtml("The Lake House", ["The lake held the fog all morning.", "Mara watched it burn off."]), "ch2.xhtml": xhtml("What the Water Keeps", ["Edith poured the tea without apology."]) }), "fixture");
  add("fixture-epub-dup.epub", epub({ "a.xhtml": xhtml("Interlude", ["First interlude paragraph content."]), "b.xhtml": xhtml("Interlude", ["Second interlude paragraph content."]) }), "fixture");
  add("fixture-epub-onedoc.epub", epub({ "book.xhtml": "<html><body><h1>The Lake House</h1><p>The lake held the fog all morning.</p><h1>Old Debts</h1><p>Edith poured the tea.</p><h2>A sub</h2><p>More.</p></body></html>" }), "fixture");
  add("hard-epub-html.epub", epub(HTML_CASE_DOCS), "fixture");
  add(
    "hard-epub-manifest.epub",
    epub(
      { "nav.xhtml": xhtml("Contents", ["nav"]), "cover.xhtml": xhtml("Cover", ["cover"]), "ch1.xhtml": xhtml("Real", ["A real chapter with enough words to count as one of them."]) },
      {
        opfText: opf([
          ["n", "nav.xhtml", "application/xhtml+xml", "nav"],
          ["c", "cover.xhtml", "application/xhtml+xml", "cover-image"],
          ["css", "style.css", "text/css"],
          ["gone", "missing.xhtml"],
          ["d", "ch1.xhtml"],
        ]),
      },
    ),
    "fixture",
  );
  add("hard-epub-badutf8.epub", epub({ "ch1.xhtml": Buffer.concat([T("<html><body><h1>Bytes</h1><p>caf"), Buffer.from([0xe9, 0x20, 0xff, 0xc3]), T(" end of the paragraph with enough words to be a chapter.</p></body></html>")]) }), "fixture");
  add("hard-epub-badopf.epub", epub({ "ch1.xhtml": xhtml("One", ["text"]) }, { opfText: '<?xml version="1.0"?><package><metadata></package>' }), "fixture");
  add("hard-epub-entityopf.epub", epub({ "ch1.xhtml": xhtml("One", ["Some words in a chapter that is long enough to keep."]) }, { title: "Caf&eacute; &amp; Co" }), "fixture");
  add("hard-epub-nocontainer.epub", zip([["mimetype", "application/epub+zip"], ["OEBPS/x.xhtml", "<p>x</p>"]]), "fixture");
  add("hard-epub-norootfile.epub", zip([["META-INF/container.xml", '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles/></container>']]), "fixture");
  add("hard-epub-bom-opf.epub", epub({ "ch1.xhtml": xhtml("Uno", ["Ünïcödé text in a chapter that is long enough to keep around."]) }, { opfText: `\ufeff${opf([["d0", "ch1.xhtml"]], { title: "Ünïcödé", lang: "" })}` }), "fixture");
  add("fixture-docx-headings.docx", docx([["The Lake House", "Heading1"], ["The lake held the fog all morning.", null], ["Mara watched it burn off.", null], ["Old Debts", "Heading1"], ["Edith poured the tea.", null]], "The Ninth Facet"), "fixture");
  add("fixture-docx-plain.docx", docx([["Only paragraph one.", null], ["Only paragraph two.", null]]), "fixture");
  add("fixture-docx-h2.docx", docx([["Part One", "Heading1"], ["Intro paragraph.", null], ["Scene break", "Heading2"], ["More paragraph.", null], ["Third", "heading_3"], ["x", "H2"], ["y", "Title"]]), "fixture");
  add(
    "hard-docx-nested.docx",
    docx([], null, {
      raw: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">  spaced  </w:t></w:r><w:r><w:t>&amp; joined&#x2014;</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>in a table</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>text box</w:t></w:r></w:p></w:txbxContent></w:pict><w:t>outer</w:t></w:r></w:p></w:body></w:document>`,
    }),
    "fixture",
  );
  add("hard-docx-malformed.docx", docx([], null, { raw: `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p></w:body></w:document>` }), "fixture");
  add("hard-docx-nodoc.docx", zip([["word/other.xml", "<x/>"]]), "fixture");
  add("hard-zip-neither.zip", zip([["readme.txt", "hello"]]), "fixture");
  add("hard-zip-broken.epub", Buffer.concat([T("PK\u0003\u0004"), Buffer.alloc(40, 1)]), "fixture");
  add("fixture-md.md", T("# One\n\nPara a.\n\nPara b.\n\n## Two\n\nPara c.\n"), "fixture");
  add("hard-md.md", T("\ufeffIntro before any heading.\r\n\r\n# Uno\r\n\r\nPara  a\r\nstill a.\r\n\r\n#### Deep heading\r\n\r\nPara b.\r\n\r\n###   Spaced   \r\n\r\n#NoSpace\r\n\r\n## Dos\r\n\r\n\r\nlast\u2028line\u000bvt\f\r\n"), "fixture");
  add("hard-md-cr.txt", T("Intro\r# Not a heading in python\r\rChapter 1\r\rText after a lone CR.\r"), "fixture");
  add("fixture-txt.txt", T("Chapter 1\n\nFirst paragraph.\n\nChapter 2\n\nSecond paragraph.\n"), "fixture");
  add("hard-txt.txt", T("Preface text.\n\nCHAPTER ONE\n\nA.\n\nchapter iv: the river\n\nB.\n\nPart 2 - and a very long title that goes past the sixty character limit\n\nC.\n\nBook XII\n\nD.\n\nChapter 12abc\n\nE.\n\n  Chapter 3  \n\nF."), "fixture");
  add("hard-txt-unicode.txt", T("Chapter ١٢\n\nArabic-Indic digits.\n\nchapter 😀\n\nemoji title\n\nCHAPTER İV\n\ndotted I\n"), "fixture");
  add("fixture-note.txt", T("Just one blob of text.\n\nAnd another paragraph."), "fixture");
  add("hard-bad-utf8.txt", Buffer.from([0x66, 0x6f, 0xff, 0x6f, 0x0a, 0xe2, 0x82]), "fixture");
  add("hard-bad-utf8-tail.srt", Buffer.from([0x31, 0x0a, 0xe2, 0x82]), "fixture");
  add("hard-binary.bin", Buffer.from([0xff, 0xfe, 0x00, 0x01, ...T("binarygarbage")]), "fixture");
  add("hard-empty.txt", Buffer.alloc(0), "fixture");
  add("hard-bom-only.txt", Buffer.from([0xef, 0xbb, 0xbf]), "fixture");
  add(
    "fixture-podcast.md",
    T(
      "# Ep. 42 — The codec episode\n\nSARAH: Welcome back to Signal and Noise. I'm Sarah, that's Jin. [warm]\n\n**JIN:** Mave, your team just shipped a codec that's half the bitrate. [curious]\n\nMAVE: [laughs] Half on a good day.\n\nAnd the trick is we stopped trying to preserve the waveform.\n\n— Mid-roll marker · ad break —\n\n## Deep dive\n\nJIN: Back to it. Before the break you said something I want to push on.\n",
    ),
    "fixture",
  );
  add("hard-podcast.md", T("[HOST]: Hi\n\n**Dr. Ana Ruiz:** Thanks.\n\nThe thing about codecs: they lie.\n\nO'NEIL: name with apostrophe\n\nde la Cruz: lowercase start\n\n---\n\n***\n\n___\n\nAN EXTREMELY LONG SPEAKER LABEL HERE: no\n\nJIN:\n\n### Third level\nwith body under it\n\nSARAH: multi\nline\n"), "fixture");
  add("fixture-lines.csv", T('id,scene,character,text\nQ01_A,Ashfall,Hale,"Halt. State your business."\nQ01_B,Ashfall,Hale,"The well\'s dry."\n'), "fixture");
  add("fixture-lines2.csv", T("scene,character,text\nintro,NARRATOR,Hello there.\n"), "fixture");
  add(
    "hard-lines.csv",
    T(
      '\ufeffScene, Character ,TEXT,delivery,pause_after_ms,line_id,extra\r\nA,Hale,"multi\r\nline ""quoted"" text",{"emotion": "angry", "speed": 1.0},500,L1\r\nA,Hale,plain,not json,1_000,,x,y,z\r\n\r\nB,,"no speaker",[1,2],abc\r\nB,Mara Vance,  spaced  ,"{""style"": ""whisper"", ""n"": 2.50}", 7 \r\n,,   ,,\r\nC,Old Sedge,last row no newline,,١٢',
    ),
    "fixture",
  );
  add("hard-lines-cr.csv", T("scene,text\nA,a\rb\n"), "fixture");
  add("hard-lines-noheader.csv", T("\nscene,text\nA,b\n"), "fixture");
  add("hard-lines-notext.csv", T("scene,character\nA,B\n"), "fixture");
  add("hard-lines-openquote.csv", T('scene,text\nA,"never closed\nstill open'), "fixture");
  add("hard-lines-dupcols.csv", T("text,TEXT,scene\nfirst,second,s\n"), "fixture");
  add("hard-lines-headeronly.csv", T("text\n"), "fixture");
  add(
    "fixture.srt",
    T("1\n00:00:01,000 --> 00:00:04,000\nNARRATOR: It began at dawn.\n\n2\n00:00:05,500 --> 00:00:08,000\nThe dock was empty.\n\n3\n00:00:08,000 --> 00:00:09,250\nMARA: You're late.\n"),
    "fixture",
  );
  add(
    "hard.srt",
    T("\ufeff00:00:01.5 --> 00:00:02.25\r\nno index line\r\n\r\n7\r\n00:00:03,000 --> 00:00:04,000\r\nDR WHO: two\r\nline cue\r\n\r\n8\r\n1:00:05,000-->1:00:06,9\r\nmr smith: lowercase\r\n\r\njunk block\r\n\r\n9\r\n00:00:07,000 --> 00:00:08,000\r\n\r\n10\r\n00:00:09,000 --> 00:00:10,000\r\nO'BRIEN-SMITH: Hello!\r\n"),
    "fixture",
  );
  add("fixture-labels.txt", T("0.000000\t4.250000\tFirst label text\n\\\t20.000000\t8000.000000\n5.000000\t6.000000\tSecond label\n9.500000\tA point label\n"), "fixture");
  add("hard-labels.txt", T("0.0005\t0.0015\tbanker's rounding\n-1.5\t2.5\tnegative\n3\t4\tints\nabc\t5\tbad start\n6\tdef\tbad end\n7.0\t\t\n٣\t٤\tarabic digits\n8.0\t9.0\ttab\tin\tlabel\n10\n"), "fixture");
  add("fixture-nolabels.txt", T("nocolumns\nnothing here\n"), "fixture");
  const std = (o) => T(JSON.stringify(o));
  add("std-valid.json", std({ schema_version: "1.0", source: "", project: { name: "Std", kind: "custom" }, characters: [{ id: "a", name: "A", aliases: ["Ay"] }], scenes: [{ id: "s", lines: [{ text: "hi", pause_after_ms: "250", delivery: { speed: 1.5 } }, { text: "yo", character_id: "a", pause_after_ms: 300.0 }] }], lexicon_entries: [{ grapheme: "Hecate", phoneme_ipa: "ˈhɛkəti" }], extra_field: 1 }), "fixture");
  add("std-oldversion.json", std({ schema_version: "0.9", source: "elsewhere", project: { name: "Old" } }), "fixture");
  for (const [n, o] of Object.entries({
    missing_source: { project: { name: "x" } },
    missing_project: { source: "s" },
    project_not_dict: { source: "s", project: "p" },
    bad_kind: { source: "s", project: { name: "x", kind: "film" } },
    name_int: { source: "s", project: { name: 5 } },
    scenes_not_list: { source: "s", project: { name: "x" }, scenes: "no" },
    scene_not_dict: { source: "s", project: { name: "x" }, scenes: [5] },
    line_missing_text: { source: "s", project: { name: "x" }, scenes: [{ id: "a", lines: [{}] }] },
    pause_bad_str: { source: "s", project: { name: "x" }, scenes: [{ id: "a", lines: [{ text: "t", pause_after_ms: "soon" }] }] },
    pause_fraction: { source: "s", project: { name: "x" }, scenes: [{ id: "a", lines: [{ text: "t", pause_after_ms: 1.5 }] }] },
    pause_list: { source: "s", project: { name: "x" }, scenes: [{ id: "a", lines: [{ text: "t", pause_after_ms: [1] }] }] },
    delivery_list: { source: "s", project: { name: "x" }, scenes: [{ id: "a", lines: [{ text: "t", delivery: [] }] }] },
    alias_int: { source: "s", project: { name: "x" }, characters: [{ id: "a", name: "A", aliases: [1] }] },
    warnings_obj: { source: "s", project: { name: "x" }, warnings: {} },
    top_list: [1, 2],
  })) {
    add(`std-bad-${n}.json`, std(o), "fixture");
  }
  add("std-bom.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), std({ source: "s", project: { name: "x" } })]), "fixture");
  add("std-badjson.json", T('{"source": "s", "project": {"name": "x",}}'), "fixture");
  add("std-badjson2.json", T('{"source": "s"\n  "project": 1}'), "fixture");
  add("std-nan.json", T('{"source": "s", "project": {"name": "x"}, "scenes": [{"id": "a", "lines": [{"text": "t", "pause_after_ms": NaN}]}]}'), "fixture");
  add("jw-bare.json", T(JSON.stringify({ project: { title: "Bare" }, parts: [{ id: "p", chapters: [{ id: "c1", title: "", num: 3 }, { id: "c2" }, "skip"] }], scenes: { c1: [{ id: "s", body: "<p>One</p>" }], c2: [{ body: "<p>Two</p><p class=\"scene-mark\">***</p>" }] }, characters: [{ id: "x", name: "", age: 40, gender: "", role: "lead", pronouns: "They/Them", aliases: ["", " Ex "] }, { id: 5, name: "Num", age: true }, { name: "no id" }, "str"] })), "fixture");
  add("jw-not-object.json", T("[1,2,3]"), "fixture");
  const jwOdd = (patch) => T(JSON.stringify({ project: { title: "Odd" }, parts: [{ id: "p", chapters: [{ id: "c1", title: "One" }] }], scenes: { c1: [{ id: "s", body: "<p>Text.</p>" }] }, ...patch }));
  add("jw-project-list.json", jwOdd({ project: [1] }), "fixture");
  add("jw-project-empty-list.json", jwOdd({ project: [] }), "fixture");
  add("jw-scenes-list.json", jwOdd({ scenes: [1] }), "fixture");
  add("jw-body-number.json", jwOdd({ scenes: { c1: [{ id: "s", body: 5 }] } }), "fixture");
  add("jw-characters-number.json", jwOdd({ characters: 7 }), "fixture");
  add("jw-characters-dict.json", jwOdd({ characters: { a: 1 } }), "fixture");
  add("jw-aliases-string.json", jwOdd({ characters: [{ id: "x", name: "X", aliases: "Ex" }] }), "fixture");
  add("jw-parts-string.json", jwOdd({ parts: "pp" }), "fixture");
  add("jw-chapters-number.json", jwOdd({ parts: [{ id: "p", chapters: 3 }] }), "fixture");
  add("jw-not-book.json", T('{"hello": "world"}'), "fixture");
  add("jw-empty.json", T(JSON.stringify({ project: {}, parts: [{ id: "p", chapters: [{ id: "c1", title: "Empty" }] }], scenes: {} })), "fixture");
  add("jw-many-empty.json", T(JSON.stringify({ project: { title: "Seven" }, parts: [{ chapters: [...Array(7).keys()].map((i) => ({ id: `c${i}`, title: `T${i}` })).concat([{ id: "real", title: "Real" }]) }], scenes: { real: [{ id: "s", body: "<p>text</p>" }] } })), "fixture");
  add("jw-nested.zip", zip([["a/b/book.json", "{}"], ["c/book.json", JSON.stringify({ parts: [], scenes: {} })], ["c/images/x.png", "png"], ["c/images/", ""], ["book.json.bak", "x"]]), "fixture");
  add("jw-nobook.zip", zip([["The Ninth Facet/notes.txt", "nope"]]), "fixture");
  add("jw-badjson.zip", zip([["B/book.json", "{not json"]]), "fixture");
  add("jw-latin1.zip", zip([["B/book.json", Buffer.from([0x7b, 0x22, 0xe9, 0x22, 0x7d])]]), "fixture");

  // ── 2. the jobs ──
  const ADAPTERS = ["justwrite", "book_prose", "podcast_markdown", "csv_lines", "srt", "audacity_labels", "justvoice_standard", "nonexistent"];
  const SPLITS = ["auto", "h1", "h1_h2", "none", "pages"];
  const jobs = [];
  inputs.forEach((inp, i) => {
    for (const source of ADAPTERS) {
      jobs.push({ input: i, source, filename: inp.name, split_on: null, preview: true, materialize: inp.kind !== "hard" });
    }
    for (const split of SPLITS) jobs.push({ input: i, source: "book_prose", filename: inp.name, split_on: split, preview: true, materialize: false });
    // The same bytes under another name (extension-driven branches).
    for (const fname of ["renamed.md", "renamed.epub", "renamed.docx", null]) jobs.push({ input: i, source: "book_prose", filename: fname, split_on: null, preview: false, materialize: false });
  });

  // ── 4. the HTML texts ──
  const html = [...HTML_CASES];
  const { decodeUtf8 } = await import("../src/py_compat.js");
  for (const inp of inputs) {
    const buf = readFileSync(inp.path);
    if (inp.name.endsWith(".html")) html.push(buf.toString("utf8"));
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      let zr;
      try {
        zr = ZipReader.fromBuffer(buf);
      } catch {
        continue;
      }
      for (const n of zr.names()) {
        if (/\.x?html?$/i.test(n)) html.push(decodeUtf8(zr.read(n), { replace: true }));
        if (n.endsWith("book.json")) {
          try {
            const snap = JSON.parse(zr.read(n).toString("utf8"));
            for (const scenes of Object.values(snap.scenes || {})) for (const s of scenes || []) if (typeof s?.body === "string") html.push(s.body);
          } catch {}
        }
      }
    } else if (inp.name.endsWith(".json")) {
      try {
        const snap = JSON.parse(buf.toString("utf8"));
        for (const scenes of Object.values(snap.scenes || {})) for (const s of Array.isArray(scenes) ? scenes : []) if (typeof s?.body === "string") html.push(s.body);
      } catch {}
    }
  }

  const jobsPath = join(dir, "jobs.json");
  writeFileSync(jobsPath, JSON.stringify({ inputs: inputs.map((x) => x.path), jobs, html }));
  console.log(`inputs: ${inputs.length} · jobs: ${jobs.length} · html texts: ${html.length}`);

  // ── run Python ──
  const pyData = dataCopy(dir, "py-data", { links: [] });
  const jsData = dataCopy(dir, "js-data", { links: [] });
  const procs = await import("@delebash/llm-runner/platform/procs");
  const pyOut = join(dir, "py.json");
  const t0 = performance.now();
  const r = await procs.run([PY, join(HERE, "compare-imports.py"), "run", jobsPath, pyData, pyOut], {
    cwd: SERVER,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    timeout: 3600,
  });
  if (r.returncode !== 0) throw new Error(`compare-imports.py failed:\n${r.stderr}`);
  console.log(`python: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const py = JSON.parse(readFileSync(pyOut, "utf8"));

  // ── run this port ──
  const session = await import("../src/database/session.js");
  const { AppState, setState } = await import("../src/app_state.js");
  const { ApiError } = await import("../src/errors.js");
  const { listAdapters, runAdapter } = await import("../src/imports/index.js");
  const { ImportRunResponse } = await import("../src/imports/standard_schema.js");
  const { htmlBlocks } = await import("../src/imports/adapters/book_prose.js");
  const { _materializeLexicon, _materializeStandard } = await import("../src/api/projects_api.js");
  const { modelDump } = await import("../src/models.js");
  session.initDb(jsData);
  setState(new AppState(jsData));
  const h = session.getDb();
  const wire = (v) => JSON.parse(JSON.stringify(v));
  const result = (fn) => {
    try {
      return { ok: fn() };
    } catch (e) {
      if (e instanceof ApiError) return { error: { status: e.statusCode, detail: e.detail } };
      return { crash: `${e?.name || "Error"}: ${e?.message ?? e}` };
    }
  };
  const t1 = performance.now();
  const js = { adapters: wire(listAdapters()), jobs: [], html: [] };
  for (const job of jobs) {
    const raw = readFileSync(inputs[job.input].path);
    const res = result(() => runAdapter(job.source, raw, { filename: job.filename, split_on: job.split_on }));
    const rec = { std: "ok" in res ? { ok: wire(res.ok) } : res };
    if (job.preview) {
      rec.preview =
        "ok" in res
          ? { status: 200, body: wire(modelDump(ImportRunResponse, { committed: false, project_id: null, standard: res.ok, warnings: res.ok.warnings })) }
          : { status: res.error?.status ?? 500, body: { detail: res.error?.detail ?? null } };
    }
    if (job.materialize && "ok" in res) {
      rec.materialized = h.tx(() => {
        const [project, scenes, blocks, created, reused] = _materializeStandard(res.ok, h);
        _materializeLexicon(res.ok, project, h);
        return { scenes, blocks, created: created.length, reused: reused.length };
      });
    }
    js.jobs.push(rec);
  }
  for (const text of html) js.html.push({ plain: result(() => htmlBlocks(text)), skip: result(() => htmlBlocks(text, { skipClasses: new Set(["scene-mark"]) })) });
  console.log(`js: ${((performance.now() - t1) / 1000).toFixed(1)} s`);

  // ── compare the answers ──
  let diffs = 0;
  const report = (label, ds) => {
    if (!ds.length) return;
    diffs += ds.length;
    for (const d of ds.slice(0, 6)) console.log(`  DIFF ${label}: ${d.slice(0, 400)}`);
  };
  report("adapters", compare(py.adapters, js.adapters));
  const kinds = { ok: 0, error: 0, crash: 0 };
  let previews = 0;
  let crashMismatch = 0;
  jobs.forEach((job, i) => {
    const a = py.jobs[i];
    const b = js.jobs[i];
    const label = `${inputs[job.input].name} · ${job.source}${job.split_on ? `/${job.split_on}` : ""}${job.filename !== inputs[job.input].name ? ` as ${job.filename}` : ""}`;
    const k = Object.keys(a.std)[0];
    kinds[k] = (kinds[k] || 0) + 1;
    if (k === "crash" || Object.keys(b.std)[0] === "crash") {
      // A crash is an uncaught exception in Python (a 500): both must crash; the words of
      // another language's exception are not compared.
      if (Object.keys(a.std)[0] !== Object.keys(b.std)[0]) {
        crashMismatch += 1;
        report(label, [`py ${JSON.stringify(a.std).slice(0, 200)} | js ${JSON.stringify(b.std).slice(0, 200)}`]);
      }
    } else report(label, compare(a.std, b.std));
    if (job.preview) {
      previews += 1;
      if (a.preview.status === 500 && "crash" in a.std) return;
      report(`${label} [preview]`, compare(a.preview, b.preview));
    }
    report(`${label} [rows]`, compare(a.materialized ?? null, b.materialized ?? null));
  });
  let htmlBlocksCount = 0;
  html.forEach((_t, i) => {
    report(`html #${i}`, compare(py.html[i], js.html[i]));
    htmlBlocksCount += py.html[i].plain.ok?.length ?? 0;
  });
  console.log(`answers: ${jobs.length} jobs (${kinds.ok} imported, ${kinds.error} refused, ${kinds.crash ?? 0} crashed in Python), ${previews} previews, ${html.length} HTML texts (${htmlBlocksCount} blocks): ${diffs} different${crashMismatch ? ` (${crashMismatch} crash mismatches)` : ""}`);
  // What crashes Python (an uncaught exception — the route answers 500) — both sides must crash.
  const crashes = new Map();
  jobs.forEach((job, i) => {
    const c = py.jobs[i].std.crash;
    if (c) crashes.set(`${job.source}: ${c.slice(0, 90)}`, [...(crashes.get(`${job.source}: ${c.slice(0, 90)}`) || []), inputs[job.input].name]);
  });
  for (const [k, v] of crashes) console.log(`  python crash (js too) — ${k}  [${[...new Set(v)].join(", ")}]`);
  if (process.env.JV_COMPARE_SELFTEST) {
    // The comparison itself must see a difference: one changed letter in one answer.
    const probe = structuredClone(js.jobs.find((j) => j.std.ok?.scenes?.[0]?.lines?.[0]));
    probe.std.ok.scenes[0].lines[0].text += "x";
    const pyTwin = py.jobs[js.jobs.findIndex((j) => j.std.ok?.scenes?.[0]?.lines?.[0])];
    console.log(`  self-test: a one-letter change shows as ${compare(pyTwin.std, probe.std).length} difference(s)`);
  }

  // ── compare the rows written ──
  session.closeDb();
  const { openDatabase } = await import("@delebash/llm-runner/platform/sql");
  const TABLES = ["projects", "speakers", "scenes", "blocks", "lexicons", "lexicon_entries"];
  const DT = /^'\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?'$/;
  const ID = /^'(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|lex_[0-9a-f]{32})'$/;
  const dump = (file) => {
    const db = openDatabase(file, { foreignKeys: false, readonly: true });
    const tokens = new Map();
    const out = {};
    for (const t of TABLES) {
      const cols = db.columnNames(t);
      const rows = db.all(`select ${cols.map((c) => `quote("${c}") as "${c}"`).join(", ")} from "${t}" order by rowid`);
      out[t] = rows.map((row) =>
        Object.fromEntries(
          cols.map((c) => {
            const v = row[c];
            if (typeof v === "string" && DT.test(v)) return [c, "<datetime>"];
            if (typeof v === "string" && ID.test(v)) {
              if (!tokens.has(v)) tokens.set(v, `<id${tokens.size}>`);
              return [c, tokens.get(v)];
            }
            return [c, v];
          }),
        ),
      );
    }
    db.close();
    return out;
  };
  const pyRows = dump(join(pyData, "justvoice.db"));
  const jsRows = dump(join(jsData, "justvoice.db"));
  let cells = 0;
  for (const t of TABLES) {
    for (const row of pyRows[t]) cells += Object.keys(row).length;
    report(`table ${t}`, compare(pyRows[t], jsRows[t]));
  }
  const counts = TABLES.map((t) => `${t} ${pyRows[t].length}`).join(", ");
  console.log(`rows: ${counts} — ${cells} cells compared`);
  console.log(diffs ? `FAILED: ${diffs} differences` : "identical");
  if (diffs) exitCode = 1;
} finally {
  try {
    const session = await import("../src/database/session.js");
    session.closeDb();
  } catch {}
  cleanup(dir);
  console.log(`removed ${dir}`);
}
process.exitCode = exitCode;
