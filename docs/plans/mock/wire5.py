"""Wire the radio pickers — all 45 of them were dead.

`pickRadio()` has existed in `_interactions.py` since the first build and **nothing
ever called it**, so every radio group in the mock was decorative: the voice-source
picker on a cast row, the emotion picker on a line, the lexicon scope, the export
options. `validate.py` could not see it, because a radio is a span.

A radio marked `.radio.off` is deliberately unavailable — it stays unselectable but
says why, which is the point of showing it at all rather than hiding it.
"""
import pathlib
import re
import sys

SP = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")

# Why a greyed radio cannot be picked, per screen. Nothing generic: if the app
# cannot say why an option is off, the option should not be on screen.
OFF_REASON = {
    "_s4.html": "Chatterbox Turbo has no tag for this emotion — pick another, "
                "or recast Marius to a voice that reads prose.",
    "_s3.html": "Design from words needs the Qwen3 VoiceDesign model. Install it first.",
}
DEFAULT_OFF = "Not available on this voice."

total_on = total_off = 0
report = []

for path in sorted(SP.glob("_s*.html")) + sorted(SP.glob("_new_*.html")):
    src = original = path.read_text(encoding="utf-8")
    off_msg = OFF_REASON.get(path.name, DEFAULT_OFF).replace("'", "\\'")
    n_on = [0]
    n_off = [0]

    def wire(m):
        attrs = m.group(1)
        if "onclick" in attrs:
            return m.group(0)
        classes = re.search(r'class="([^"]*)"', attrs).group(1).split()
        if "off" in classes:
            n_off[0] += 1
            act = "toast('%s','warn')" % off_msg
        else:
            n_on[0] += 1
            act = "pickRadio(this)"
        return '<span%s onclick="%s">' % (attrs, act)

    src = re.sub(r'<span((?=[^>]*class="[^"]*\bradio\b)[^>]*)>', wire, src)

    if src != original:
        path.write_text(src, encoding="utf-8", newline="\n")
    total_on += n_on[0]
    total_off += n_off[0]
    if n_on[0] or n_off[0]:
        report.append("  %-22s %2d selectable  %2d unavailable-with-a-reason"
                      % (path.name, n_on[0], n_off[0]))

print("wire5: %d radios wired, %d greyed ones now explain themselves"
      % (total_on, total_off))
print("\n".join(report))
