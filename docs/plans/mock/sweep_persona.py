"""One-off: the terminology sweep of redesign doc 8.4 — never "character".

Exact-string replacements only. No regex: a bad `re.sub` has already eaten a
closing tag in this mock once.
"""
import pathlib
import sys

SP = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")

EDITS = [
    ("_s1.html",
     "character &middot; one character per name the source knew.",
     "persona &middot; one persona per name the source knew."),
    ("_s1.html",
     "character · one character per name the source knew.",
     "persona · one persona per name the source knew."),
    ("_s10.html", ">One character<", ">One persona<"),
    ("_s10.html", "A character-scoped lexicon beats", "A persona-scoped lexicon beats"),
    ("_s11.html", "The character's chain runs first", "The persona's chain runs first"),
    ("_s11.html", "reusable on any character or scene", "reusable on any persona or scene"),
    ("_s11.html", "Reusable on any character or any scene.", "Reusable on any persona or any scene."),
    ("_s12.html", "on top of</b> each character's chain", "on top of</b> each persona's chain"),
    ("_s12.html", "Every character still sounds like themselves.",
     "Every persona still sounds like themselves."),
    ("_s3.html", '<span class="hint">the character</span>', '<span class="hint">who is speaking</span>'),
    ("_s3.html", "if a character needs one for a flashback", "if a persona needs one for a flashback"),
    ("_s3.html", "<i>character</i> rather than the instrument", "<i>persona</i> rather than the instrument"),
    ("_s4.html", "&#9997;&#65039; Rewrite in character", "&#9997;&#65039; Rewrite as June"),
    ("_s4.html", "✏️ Rewrite in character", "✏️ Rewrite as June"),
    ("_s6.html", "A voice is an instrument, not a character", "A voice is an instrument, not a persona"),
    ("_s6.html", "How a particular character speaks", "How a particular persona speaks"),
    ("_s6.html", "its characters are shaped with pace", "its personas are shaped with pace"),
    ("_s7.html", "<b>How a character speaks</b>", "<b>How a persona speaks</b>"),
    ("_s7.html", "no character needed &mdash; you are judging", "no persona needed &mdash; you are judging"),
    ("_s7.html", "no character needed — you are judging", "no persona needed — you are judging"),
    ("_s9.html", "<th>Character</th>", "<th>Persona</th>"),
]

applied, missed = 0, []
for fname, old, new in EDITS:
    p = SP / fname
    s = p.read_text(encoding="utf-8")
    if old not in s:
        missed.append((fname, old[:52]))
        continue
    p.write_text(s.replace(old, new), encoding="utf-8", newline="\n")
    applied += 1

print("applied:", applied)
for f, o in missed:
    print(("  no match (ok if an encoding twin matched): %s :: %s" % (f, o))
          .encode("ascii", "replace").decode())

left = []
for p in sorted(SP.glob("_s*.html")) + sorted(SP.glob("_new_*.html")):
    s = p.read_text(encoding="utf-8").lower()
    if "character" in s:
        left.append("%s x%d" % (p.name, s.count("character")))
print("files still containing 'character':", left or "none")
