"""Second wiring pass: every remaining control on every screen."""
import pathlib, re, sys

SP = pathlib.Path(sys.argv[1])
Q = chr(39)


def T(msg, kind=""):
    k = ("," + Q + kind + Q) if kind else ""
    return "toast(" + Q + msg + Q + k + ")"


def N(route):
    return "nav(" + Q + route + Q + ")"


def M(mid):
    return "openModal(" + Q + mid + Q + ")"


# label -> js.  Matched on the exact button text, per file.
PLAN = {
    "_new_home.html": {
        "Unload": T("Kokoro unloaded — 3.2 GB freed.", "ok"),
    },
    "_new_lines.html": {
        "⚡ Render 123": N("render"),
        "▶ Gen": T("Rendering this line…", "ok"),
        "↻ Re-render": T("Re-rendering — the old take is kept.", "ok"),
        "🎙️ Cast selected…": N("cast"),
        "✍️ Write directions for selected": T("Writing directions for the selected lines.", "ok"),
    },
    "_s3.html": {   # cast
        "✨ Auto-cast everyone": T("Proposed a voice for Harbek and Renn — review before rendering.", "ok"),
        "＋ Add from library": N("personas"),
        "▶ Listen": T("Hearing June as cast…"),
        "↻ Her real first line": T("Loaded her first line from chapter 1."),
        "Load Chatterbox (~40 s)": T("Loading Chatterbox — Kokoro will unload.", "warn"),
        "🎤 Clone &amp; cast to Marius": T("Clone created and cast to Marius.", "ok"),
        "✨ Suggest one": T("Suggested Uncle Fu for Harbek — accept or pick another."),
        "Clone from audio": N("newvoice"),
        "🎙️ Cast selected to…": T("Pick a voice to apply to every ticked character."),
    },
    "_s4.html": {   # render
        "⏹ Stop": T("Render stopped at line 71. Finished lines are kept.", "warn"),
        "⚡ Render pending": T("Rendering 187 lines — progress above.", "ok"),
        "↻ Re-render all": T("Re-rendering all 214 lines from scratch.", "warn"),
        "🧹 Clear cache": T("Cache cleared — every line will re-render next time.", "warn"),
        "⤓ WAV": T("Chapter WAV saved."),
    },
    "_s5.html": {   # export
        "⤓ Export 14 chapters": T("Exporting 14 chapters to E:\\\\Books\\\\Stillwater…", "ok"),
        "…": T("File picker"),
    },
    "_s6.html": {   # voices
        "✨ Guess unknown genders": T("Asked the model about 7 unlabelled voices.", "ok"),
        "＋ New voice": N("newvoice"),
        "▶": T("Playing the stock sample…"),
    },
    "_s7.html": {   # workbench
        "▶ Listen": T("Hearing Sohee with your line…"),
        "↻ Stock line": T("Loaded the stock sample line."),
        "★ Keep take": T("Take kept — it will appear under this voice.", "ok"),
        "⚖️ Compare settings…": T("Pick a knob and three values to hear side by side."),
        "💾 Save as a new voice": T("Saved “Heart (warm)” — it is yours, and renameable.", "ok"),
        "🔀 Blend with…": N("newvoice"),
        "🧪 Train a LoRA": N("newvoice"),
        "🎲": T("New random seed."),
    },
    "_s8.html": {   # new voice door
        "⤓ Install": T("Downloading Qwen3 VoiceDesign…", "ok"),
        "▶ Preview": T("Previewing the clone candidate…"),
    },
    "_s10.html": {  # lexicons
        "＋ Add": M("word"),
        "▶": T("Hearing it as June…"),
    },
    "_s11.html": {  # effects
        "＋ Add effect": M("effect"),
        "▶ Dry": T("Playing without the chain."),
        "▶ Wet": T("Playing with the chain."),
        "💾 Save chain": T("Chain saved — reusable on any character or scene.", "ok"),
    },
    "_s12.html": {  # scene
        "💾 Save this": T("Direction saved as a reusable snippet.", "ok"),
        "Edit": N("effects"),
        "Apply": T("Flashback applied to chapter 7 — 231 lines marked stale.", "ok"),
        "▶ Without": T("Playing line 3 without the scene."),
        "▶ With": T("Playing line 3 with the scene."),
    },
    "_s13.html": {  # engines
        "Unload": T("Kokoro unloaded — 3.2 GB freed.", "ok"),
        "Load": T("Loading — the current engine unloads first.", "warn"),
        "Install": T("Building the isolated venv — this takes a few minutes.", "warn"),
    },
    "_new_projects.html": {
        "＋ New project": N("new"),
    },
}


def wire(path, table):
    p = SP / path
    if not p.exists():
        print("skip (missing)", path)
        return
    s = p.read_text(encoding="utf-8")
    hits = 0

    def repl(m):
        nonlocal hits
        whole, cls, label = m.group(0), m.group(1), m.group(2)
        if "onclick" in whole or "disabled" in whole:
            return whole
        js = table.get(label.strip())
        if not js:
            return whole
        hits += 1
        return '<button class="btn' + cls + '" onclick="' + js + '">' + label + "</button>"

    s = re.sub(r'<button class="btn([^"]*)"([^>]*)>([^<]*)</button>',
               lambda m: repl_full(m, table), s)

    def repl_full(m, table):
        pass

    p.write_text(s, encoding="utf-8", newline="\n")


# simpler, explicit: rebuild each button tag
def wire2(path, table):
    p = SP / path
    if not p.exists():
        print("skip (missing)", path)
        return
    s = p.read_text(encoding="utf-8")
    hits = 0

    def sub(m):
        nonlocal hits
        attrs, label = m.group(1), m.group(2)
        if "onclick" in attrs or "disabled" in attrs:
            return m.group(0)
        js = table.get(label.strip())
        if not js:
            return m.group(0)
        hits += 1
        return "<button" + attrs + ' onclick="' + js + '">' + label + "</button>"

    s = re.sub(r"<button([^>]*)>([^<]*)</button>", sub, s)
    p.write_text(s, encoding="utf-8", newline="\n")
    print(path, "-> wired", hits)


for path, table in PLAN.items():
    wire2(path, table)
