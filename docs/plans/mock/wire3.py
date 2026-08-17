"""Final sweep: no button anywhere is inert."""
import pathlib, re, sys

SP = pathlib.Path(sys.argv[1])
Q = chr(39)


def T(msg, kind=""):
    k = ("," + Q + kind + Q) if kind else ""
    return "toast(" + Q + msg + Q + k + ")"


def action_for(label):
    L = label.strip()
    if "Compare" in L:
        return "openModal(" + Q + "compare" + Q + ")"
    if L in ("▶",):
        return T("Playing…")
    if L.startswith("▶"):
        return T("Playing…")
    if L in ("⏹",):
        return T("Stopped. Finished lines are kept.", "warn")
    if L in ("🎲",):
        return T("New random seed.")
    if L in ("…",):
        return T("File picker")
    if L in ("⤓",):
        return T("Saved.")
    if not L:
        return T("Playing…")
    return T(L.replace(Q, "") + " — not wired in the mock.")


total = 0
for f in sorted(SP.glob("_s*.html")) + sorted(SP.glob("_new_*.html")):
    s = f.read_text(encoding="utf-8")
    n = 0

    def sub(m):
        global n
        attrs, label = m.group(1), m.group(2)
        if "onclick" in attrs or "disabled" in attrs:
            return m.group(0)
        n += 1
        return "<button" + attrs + ' onclick="' + action_for(label) + '">' + label + "</button>"

    s = re.sub(r"<button([^>]*)>([^<]*)</button>", sub, s)
    if n:
        f.write_text(s, encoding="utf-8", newline="\n")
        print(f.name, "->", n)
        total += n
print("total swept:", total)
