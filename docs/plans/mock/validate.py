"""Structure + navigation + dead-control validation for the mock."""
import pathlib
import re
import sys

SP = pathlib.Path(sys.argv[1])
html = (SP / "workbench-mock.html").read_text(encoding="utf-8")


def out(s):
    print(s.encode("ascii", "replace").decode())


VOID = {"br", "hr", "img", "input", "meta", "link", "source", "col", "area", "base", "wbr"}
stack, errs = [], []
for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>", html):
    close, tag, attrs, self_close = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
    if tag in VOID or self_close:
        continue
    if not close:
        stack.append((tag, m.start()))
    else:
        if not stack:
            errs.append("stray </%s> at %d" % (tag, m.start()))
        elif stack[-1][0] != tag:
            errs.append("</%s> at %d closes <%s> opened at %d"
                        % (tag, m.start(), stack[-1][0], stack[-1][1]))
            stack.pop()
        else:
            stack.pop()
out("1. TAG STRUCTURE: %s" % ("clean" if not errs and not stack else "BROKEN"))
for e in errs[:8]:
    out("   " + e)
for t, i in stack[:8]:
    out("   unclosed <%s> at %d" % (t, i))

routes = set(re.findall(r'<div class="route" id="r-([a-z0-9]+)"', html))
targets = set(re.findall(r"nav\('([a-z0-9]+)'\)", html))
out("2. ROUTES: %d -> %s" % (len(routes), " ".join(sorted(routes))))
dangling = sorted(targets - routes)
orphan = sorted(routes - targets - {"home"})
out("   dangling nav targets: %s" % (", ".join(dangling) if dangling else "none"))
out("   routes nothing links to: %s" % (", ".join(orphan) if orphan else "none"))

btns = re.findall(r"<button([^>]*)>(.*?)</button>", html, re.S)
dead = [(a, re.sub(r"\s+", " ", b).strip()[:44])
        for a, b in btns if "onclick" not in a and "disabled" not in a]
disabled = [b for a, b in btns if "disabled" in a]
out("3. CONTROLS: %d buttons | %d dead | %d deliberately disabled"
    % (len(btns), len(dead), len(disabled)))
for a, b in dead[:12]:
    out("   DEAD: %s" % b)

lnks = re.findall(r'class="lnk"([^>]*)>', html)
dead_lnk = [x for x in lnks if "onclick" not in x]
out("4. .lnk spans: %d | without onclick: %d" % (len(lnks), len(dead_lnk)))

out("5. STEPS: %s" % ", ".join(sorted(set(
    re.findall(r'class="stp[^"]*"[^>]*>([^<]+)</span>', html)))))
out("6. character/persona: %d / %d"
    % (len(re.findall(r"[Cc]haracters?\b", html)), len(re.findall(r"[Pp]ersonas?\b", html))))

# --- 7-9 added 2026-08-17. Checks 1-6 passed a mock whose entire Personas table,
# and 53 glyph controls across 12 screens, did nothing at all: check 3 counts only
# button elements, so a control built from a span or a tr was never looked at.

GLYPHS = "⌃⌄⋯▶★\U0001f5d1⤓✕"
leaf = re.findall(r"<span([^>]*)>\s*([" + GLYPHS + r"])\s*</span>", html)
dead_glyph = [g for a, g in leaf if "onclick" not in a]
out("7. GLYPH CONTROLS: %d | dead: %d" % (len(leaf), len(dead_glyph)))
if dead_glyph:
    out("   DEAD GLYPHS: %s" % " ".join(sorted(set(dead_glyph))))

# A row is only expected to click where the screen's own copy promises it.
for rid in ("voices", "personas"):
    m = re.search(r'<div class="route" id="r-%s">(.*?)(?=<div class="route"|\Z)' % rid, html, re.S)
    if not m:
        continue
    body = m.group(1).partition("</thead>")[2]
    trs = re.findall(r"<tr\b[^>]*>", body)
    out("8. ROWS on %-9s %d | not clickable: %d"
        % (rid, len(trs), len([t for t in trs if "onclick" not in t])))

# Two identical function names in one script silently deletes the first one.
js = "\n".join(re.findall(r"<script>(.*?)</script>", html, re.S))
names = re.findall(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(", js)
dupes = sorted({n for n in names if names.count(n) > 1})
out("9. JS FUNCTIONS: %d | duplicate definitions: %s"
    % (len(names), ", ".join(dupes) if dupes else "none"))
# Every function an onclick calls has to exist.
called = set(re.findall(r'onclick="\s*([A-Za-z_$][\w$]*)\s*\(', html))
missing = sorted(called - set(names) - {"toast", "if", "for", "while", "return"})
out("   handlers called but never defined: %s" % (", ".join(missing) if missing else "none"))
