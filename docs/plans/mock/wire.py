"""Wire every control in the mock to a real destination or a real action."""
import pathlib, sys

SP = pathlib.Path(sys.argv[1])
Q = chr(39)  # single quote, kept out of the literals below


def onclick(js):
    return 'onclick="' + js + '"'


def sub(path, pairs):
    p = SP / path
    s = p.read_text(encoding="utf-8")
    missed = []
    for a, b in pairs:
        if a not in s:
            missed.append(a[:60])
        s = s.replace(a, b)
    p.write_text(s, encoding="utf-8", newline="\n")
    print(path, "->", len(pairs) - len(missed), "of", len(pairs), "applied")
    for m in missed:
        print("    already-wired or miss:", m.encode("ascii", "replace").decode())


BTN = '<button class="btn'


def btn(label, cls, js):
    """Rewrite a button by its exact label, adding an onclick."""
    old = BTN + cls + '">' + label + '</button>'
    new = BTN + cls + '" ' + onclick(js) + '>' + label + '</button>'
    return (old, new)


# ─────────────────────────── chapter editor ───────────────────────────
sub("_s2.html", [
    btn("✨ Analyze", " p", "openScope(" + Q + "Analyze" + Q + ")"),
    btn("🔍 Discover speakers", "", "openScope(" + Q + "Discover speakers" + Q + ")"),
    btn("🔎 Review attribution", "", "toast(" + Q + "Review pass queued on 9 low-confidence lines." + Q + "," + Q + "ok" + Q + ")"),
    btn("✍️ Write directions", "", "toast(" + Q + "Writing directions for 214 lines — review each before rendering." + Q + "," + Q + "ok" + Q + ")"),
    btn("🎭 Auto-cast", "", "nav(" + Q + "cast" + Q + ")"),
    btn("▶ Play chapter", "", "toast(" + Q + "Playing the 27 rendered lines in order." + Q + ")"),
    btn("⚡ Render 187", " p", "nav(" + Q + "render" + Q + ")"),
    btn("＋ Create and add to cast", " s", "toast(" + Q + "3 characters created and added to the cast." + Q + "," + Q + "ok" + Q + ");nav(" + Q + "cast" + Q + ")"),
    btn("Merge into an existing character…", " s", "nav(" + Q + "cast" + Q + ")"),
    btn("Ignore", " s g", "toast(" + Q + "Ignored — not offered again for this chapter." + Q + ")"),
    btn("▶ Gen", " s p", "toast(" + Q + "Rendering this line…" + Q + "," + Q + "ok" + Q + ")"),
    btn("↻ Re-render", " s", "toast(" + Q + "Re-rendering — the old take is kept." + Q + "," + Q + "ok" + Q + ")"),
    btn("🎙️ Cast him", " s", "nav(" + Q + "cast" + Q + ")"),
    btn("⚖️ Compare two takes", " s", "openModal(" + Q + "compare" + Q + ")"),
    btn("▶ Generate", " p", "toast(" + Q + "Rendering this line…" + Q + "," + Q + "ok" + Q + ")"),
    btn("✏️ Rewrite in character", "", "toast(" + Q + "Rewrite proposed — accept or discard before it replaces the text." + Q + ")"),
    btn("⌃ prev", " s", "toast(" + Q + "Line 1 of 214" + Q + ")"),
    btn("⌄ next", " s", "toast(" + Q + "Line 3 of 214" + Q + ")"),
    btn("✕ close", " s g", "toast(" + Q + "Row collapsed" + Q + ")"),
    # filter chips
    ('<span class="tag ok">All 214</span>',
     '<span class="tag ok" data-filter="all" onclick="pickChip(this)">All 214</span>'),
    ('<span class="tag e">9 below the floor</span>',
     '<span class="tag e" data-filter="floored" onclick="pickChip(this)">9 below the floor</span>'),
    ('<span class="tag e">3 no answer</span>',
     '<span class="tag e" data-filter="noans" onclick="pickChip(this)">3 no answer</span>'),
    ('<span class="tag w">40 uncast</span>',
     '<span class="tag w" data-filter="uncast" onclick="pickChip(this)">40 uncast</span>'),
    ('<span class="tag pd">187 not rendered</span>',
     '<span class="tag pd" data-filter="pending" onclick="pickChip(this)">187 not rendered</span>'),
    ('<span class="tag">9 stale</span>',
     '<span class="tag" data-filter="stale" onclick="pickChip(this)">9 stale</span>'),
    ('<span class="tag">27 done</span>',
     '<span class="tag" data-filter="done" onclick="pickChip(this)">27 done</span>'),
])

# ─────────────────────────── chapter list ─────────────────────────────
sub("_new_chapters.html", [
    btn("✨ Analyze the book", " p", "openScope(" + Q + "Analyze" + Q + ")"),
    btn("🔍 Discover speakers", "", "openScope(" + Q + "Discover speakers" + Q + ")"),
    btn("↻ Re-render 128 stale", "", "nav(" + Q + "render" + Q + ")"),
    btn("⚡ Render 1,281 ready", " p", "nav(" + Q + "render" + Q + ")"),
    btn("＋ Add chapter", " s", "toast(" + Q + "Chapter 15 added — empty, ready for text." + Q + "," + Q + "ok" + Q + ")"),
    ('<span class="tag ok">All 14</span>',
     '<span class="tag ok" data-filter="all" onclick="pickChip(this)">All 14</span>'),
    ('<span class="tag e">Blocked 3</span>',
     '<span class="tag e" data-filter="blocked" onclick="pickChip(this)">Blocked 3</span>'),
    ('<span class="tag pd">Ready 7</span>',
     '<span class="tag pd" data-filter="ready" onclick="pickChip(this)">Ready 7</span>'),
    ('<span class="tag">Rendered 4</span>',
     '<span class="tag" data-filter="done" onclick="pickChip(this)">Rendered 4</span>'),
])

# per-row state for the chapter list filter
p = SP / "_new_chapters.html"
s = p.read_text(encoding="utf-8")
s = s.replace('<div class="tw"><table>', '<div class="tw"><table data-filterable>', 1)
states = ["blocked", "done", "done", "blocked", "ready", "blocked"]
i = 0
out = []
for line in s.split("\n"):
    if line.strip().startswith('<tr onclick="nav(' + Q + 'chapter' + Q + ')"') and i < len(states):
        line = line.replace("<tr ", '<tr data-state="' + states[i] + '" ', 1)
        i += 1
    out.append(line)
s = "\n".join(out)
p.write_text(s, encoding="utf-8", newline="\n")
print("_new_chapters -> tagged", i, "rows with state")

# per-row state for the line table
p = SP / "_s2.html"
s = p.read_text(encoding="utf-8")
s = s.replace('<div class="tw"><table>', '<div class="tw"><table data-filterable>', 1)
line_states = ["done", "pending", None, "pending", "stale", "noans", "uncast"]
i = 0
out = []
for line in s.split("\n"):
    st = line.strip()
    if st.startswith("<tr>") or st.startswith('<tr style="background:var(--accent-soft)">'):
        if i < len(line_states) and line_states[i]:
            line = line.replace("<tr", '<tr data-state="' + line_states[i] + '"', 1)
        i += 1
    out.append(line)
s = "\n".join(out)
p.write_text(s, encoding="utf-8", newline="\n")
print("_s2 -> tagged", i, "line rows")
