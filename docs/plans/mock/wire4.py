"""Wire the controls that are not <button> — the blind spot that let a dead mock ship.

`validate.py` counted `<button>` elements only. Every glyph control is
`<span class="rt"><span>&#9654;</span></span>` and every clickable table row is a
plain `<tr>`, so 53 dead controls and an entirely inert Personas table passed as
"0 dead" without ever being checked.

Deliberately NOT a nested-tag regex — that has eaten a closing tag in this mock
before. It matches only the leaf pattern `<span>GLYPH</span>`, which cannot nest.

Idempotent: anything that already carries an onclick is left alone.
"""
import pathlib
import re
import sys

SP = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")

# glyph -> the action it depicts. Production copy, never "not wired in the mock".
ACTION = {
    "⌃": "toggleRow(this)",                                    # up chevron
    "⌄": "toggleRow(this)",                                    # down chevron
    "⋯": "openModal('rowmenu')",                               # horizontal ellipsis
    "▶": "toast('Playing…')",                             # play
    "★": "toast('Promoted — this is the live take now.','ok')",
    "\U0001f5d1": "toast('Deleted. The other takes are kept.','warn')",
    "⤓": "toast('Saved the WAV.')",                            # down-arrow-to-bar
    "✕": "toast('Closed')",
}

# Screens whose own copy promises a row click, and where that click should land.
# Voices: "click it, or the row, to open the workbench".
# Personas: the index exists to open the same editor a Cast row opens (redesign 8.3a).
ROW_NAV = {
    "_s6.html": "nav('workbench')",
    "_s9.html": "openPersona(this)",
}

LEAF = re.compile(r"<span>([^<>]{1,3})</span>")

spans = rows = 0
report = []

for path in sorted(SP.glob("_s*.html")) + sorted(SP.glob("_new_*.html")):
    src = original = path.read_text(encoding="utf-8")
    counted = [0]

    def wire(m):
        act = ACTION.get(m.group(1).strip())
        if not act:
            return m.group(0)
        counted[0] += 1
        return '<span onclick="%s">%s</span>' % (act, m.group(1))

    src = LEAF.sub(wire, src)
    n_span = counted[0]

    n_row = 0
    if path.name in ROW_NAV:
        act = ROW_NAV[path.name]
        head, sep, body = src.partition("</thead>")   # never the header row
        out, last = [], 0
        for m in re.finditer(r"<tr\b[^>]*>", body):
            tag = m.group(0)
            if "onclick" in tag:
                continue
            out.append(body[last:m.start()])
            out.append(tag[:-1] + ' onclick="%s" style="cursor:pointer">' % act
                       if "style=" not in tag
                       else tag[:-1] + ' onclick="%s">' % act)
            last = m.end()
            n_row += 1
        out.append(body[last:])
        src = head + sep + "".join(out)

    if src != original:
        path.write_text(src, encoding="utf-8", newline="\n")
    spans += n_span
    rows += n_row
    if n_span or n_row:
        report.append("  %-22s %2d glyphs  %2d rows" % (path.name, n_span, n_row))

print("wire4: %d glyph controls, %d rows" % (spans, rows))
print("\n".join(report))
