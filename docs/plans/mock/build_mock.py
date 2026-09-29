"""Assemble the JustVoice screen mock: one persistent shell + routed screens."""
import pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(sys.argv[1])))
import _interactions as IX

SP = pathlib.Path(sys.argv[1])
head = (SP / "_head.html").read_text(encoding="utf-8")


def stash(n):
    return (SP / f"_s{n}.html").read_text(encoding="utf-8").rstrip()


def new(name):
    return (SP / f"_new_{name}.html").read_text(encoding="utf-8").rstrip()


EXTRA_CSS = """
<style>
.shell{max-width:1360px;margin:0 auto;padding:16px}
.app{min-height:88vh}
.rail i{cursor:pointer}
.rail i:hover{color:var(--ink)}
.rail i.dim{opacity:.35;cursor:default}
.rail i.dim:hover{color:var(--ink-3)}
.lnk{color:var(--accent-ink);text-decoration:underline;cursor:pointer}
.route{display:none}
.route.on{display:block}
body[data-kind="audiobook"] .k-game,body[data-kind="audiobook"] .k-pod,
body[data-kind="game"] .k-book,body[data-kind="game"] .k-pod,
body[data-kind="podcast"] .k-book,body[data-kind="podcast"] .k-game{display:none!important}
.steps-strip{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px}
.steps-strip .stp{font-size:11px;font-weight:600;border:1px solid var(--line-strong);
  border-radius:var(--r-pill);padding:4px 11px;color:var(--ink-2);background:var(--surface);cursor:pointer}
.steps-strip .stp:hover{border-color:var(--accent-line);color:var(--ink)}
.steps-strip .stp.on{background:var(--accent);border-color:var(--accent);color:#fff}

/* One state vocabulary, rolled up at every zoom level. */
.statebar{display:flex;height:7px;border-radius:4px;overflow:hidden;background:var(--surface-3)}
.statebar b{display:block;height:100%}
.s-nospk{background:var(--danger)}
.s-novoice{background:var(--gold)}
.s-ready{background:var(--line-strong)}
.s-done{background:var(--accent)}
.s-stale{background:oklch(0.62 0.10 265)}
.rowacts{white-space:nowrap;text-align:right}
.rowacts .btn{margin-left:5px}

/* Script's chapter page is the app's own table: one row per line, a speaker dropdown on
   every row, column headings (ruled 2026-09-29 - "see original is easy to understand";
   two screenplay layouts before it hid the one control that matters). The lines of a
   paragraph sit together: the divider is drawn only under a paragraph's last line. A line
   to check is tinted and says why in its Check column. */
.scrt td{padding:8px;vertical-align:middle}
.scrt tr.ln{cursor:pointer}
.scrt tr.ln td{border-bottom-color:transparent}
.scrt tr.ln.pend td{border-bottom-color:var(--line)}
.scrt tr.narr td,.scrt tr.mk td{color:var(--ink-3)}
.scrt tr.mk{cursor:default}
.scrt tr.mk td{font-style:italic}
.scrt tr.chk td,.scrt tr.none td{background:var(--danger-bg)}
.scrt tr.chk td:first-child,.scrt tr.none td:first-child{box-shadow:inset 3px 0 0 var(--danger)}
.scrt tr.sel td{background:var(--accent-soft)}
.scrt tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
.scrt td.ck{font-size:11px;font-weight:650;color:var(--danger-ink)}
.scrt td.ck .ckb{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.scrt td.by .ev{font-style:italic;color:var(--ink)}
.scrt td select.box{min-width:170px}
.scrt .q{font-size:12.5px;line-height:1.5}

/* A control the current voice cannot honour is shown, disabled, with its reason —
   never hidden, or the user cannot tell the difference between "off" and "absent". */
.box:disabled{opacity:.5;cursor:not-allowed;background:var(--surface-2)}

/* .box is width:100%, which is right in a form and wrong in a table cell: the cell
   absorbs the table's slack and the control stretches with it. In a cell, size to
   content. */
td > select.box,td > input.box{width:auto;max-width:100%;min-width:150px}

/* Cast is a matching task: speakers on the left, the library on the right, click one
   then the other. A dropdown per row cannot audition, cannot show engine or gender,
   and is unusable at 63 entries. */
.cast2{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:14px;align-items:start}
.spkgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:9px}
.spkcard{border:1px solid var(--line);border-radius:var(--r-card);padding:10px 12px;
  background:var(--surface);cursor:pointer;display:flex;gap:10px;align-items:flex-start}
.spkcard:hover{border-color:var(--accent-line);background:var(--surface-2)}
.spkcard.sel{border-color:var(--accent);background:var(--accent-soft);box-shadow:0 0 0 1px var(--accent)}
.spkcard .nm{font-weight:700;font-size:12.5px}
.spkcard .de{font-size:11px;color:var(--ink-3);line-height:1.35;margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.spkcard .as{font-size:11px;font-weight:650;margin-top:5px}
.spkcard .as.none{color:var(--danger-ink)}
.spkcard .as.has{color:var(--accent-ink)}
.libr{display:flex;align-items:center;gap:9px;padding:7px 10px;border-bottom:1px solid var(--line);
  cursor:pointer;font-size:12px}
.libr:hover{background:var(--surface-2)}
.libr:last-child{border-bottom:0}
.libr .nm{font-weight:650}
.libr .mt{font-size:10.5px;color:var(--ink-3);font-family:var(--font-mono)}
.libscroll{max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-card)}
.libtabs{display:flex;gap:5px;margin-bottom:8px}
</style>
"""

RAIL = """<nav class="rail" aria-label="Main">
  <div class="gh">Work</div>
  <i data-r="home" onclick="nav('home')"><span class="e">&#127968;</span>Home</i>
  <i data-r="projects" onclick="nav('projects')"><span class="e">&#128193;</span>Projects</i>

  <i data-r="overview discover chapters lines chapter cast render export scene" onclick="nav('overview')"><span class="e">&#127916;</span>Studio</i>

  <i class="dim" title="Not part of this redesign"><span class="e">&#127908;</span>Captures</i>
  <div class="gh">Library</div>
  <i data-r="personas" onclick="nav('personas')"><span class="e">&#127917;</span>Personas</i>
  <i data-r="voices" onclick="nav('voices')"><span class="e">&#127897;&#65039;</span>Voices</i>
  <i data-r="lexicons" onclick="nav('lexicons')"><span class="e">&#128213;</span>Lexicons</i>
  <i data-r="effects" onclick="nav('effects')"><span class="e">&#127899;&#65039;</span>Effects</i>
  <div class="gh">System</div>
  <i data-r="engines" onclick="nav('engines')"><span class="e">&#9881;&#65039;</span>AI</i>
  <i class="dim" title="Not part of this redesign"><span class="e">&#128295;</span>Settings</i>
</nav>"""


def steps(active):
    """Studio step strip."""
    def cls(key):
        return "stp on" if key == active else "stp"
    # Discover runs first because attribution can only pick personas that exist.
    # A game sheet already names its speakers, so it has no Discover and no Script.
    return (
        '    <div class="steps-strip">\n'
        f'      <span class="{cls("overview")}" onclick="nav(\'overview\')">Overview</span>\n'
        f'      <span class="{cls("discover")} k-book" onclick="nav(\'discover\')">1 &middot; Discover</span>\n'
        f'      <span class="{cls("discover")} k-pod" onclick="nav(\'discover\')">1 &middot; Discover</span>\n'
        f'      <span class="{cls("script")} k-book" onclick="nav(\'chapters\')">2 &middot; Script</span>\n'
        f'      <span class="{cls("script")} k-pod" onclick="nav(\'chapters\')">2 &middot; Script</span>\n'
        f'      <span class="{cls("script")} k-game" onclick="nav(\'lines\')">1 &middot; Lines</span>\n'
        f'      <span class="{cls("cast")} k-book" onclick="nav(\'cast\')">3 &middot; Cast</span>\n'
        f'      <span class="{cls("cast")} k-pod" onclick="nav(\'cast\')">3 &middot; Cast</span>\n'
        f'      <span class="{cls("cast")} k-game" onclick="nav(\'cast\')">2 &middot; Cast</span>\n'
        f'      <span class="{cls("render")} k-book" onclick="nav(\'render\')">4 &middot; Render</span>\n'
        f'      <span class="{cls("render")} k-pod" onclick="nav(\'render\')">4 &middot; Render</span>\n'
        f'      <span class="{cls("render")} k-game" onclick="nav(\'render\')">3 &middot; Render</span>\n'
        f'      <span class="{cls("export")} k-book" onclick="nav(\'export\')">5 &middot; Export</span>\n'
        f'      <span class="{cls("export")} k-pod" onclick="nav(\'export\')">5 &middot; Export</span>\n'
        f'      <span class="{cls("export")} k-game" onclick="nav(\'export\')">4 &middot; Export</span>\n'
        '    </div>\n'
    )


def inject_steps(body, active):
    """Put the step strip as the first child of the screen's .body div."""
    m = re.search(r'<div class="body">', body)
    i = m.end()
    # Some screens open content on the same line as the div; keep it valid either way.
    return body[:i] + "\n" + steps(active) + body[i:]


def linkify(body):
    """Make hard-coded crumbs navigate, and let the project name follow the open project."""
    body = body.replace(
        '<span class="crumb">Stillwater › Ch. 1 — The Ninth Door</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'overview\')">'
        '<span class="proj-name">Stillwater</span></span> › Ch. 1 — The Ninth Door</span>')
    body = body.replace(
        '<span class="crumb">Stillwater › Cast</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'overview\')">'
        '<span class="proj-name">Stillwater</span></span> › Cast</span>')
    body = body.replace(
        '<span class="crumb">Stillwater › Export</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'overview\')">'
        '<span class="proj-name">Stillwater</span></span> › Export</span>')
    body = body.replace(
        '<span class="crumb">Ch. 1 › Render</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'chapter\')">Ch. 1</span> › Render</span>')
    body = body.replace(
        '<span class="crumb">Ch. 7 › Scene</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'overview\')">'
        '<span class="proj-name">Stillwater</span></span> › Ch. 7 › Scene</span>')
    body = body.replace(
        '<span class="crumb">Voices › Sohee</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'voices\')">Voices</span> › Sohee</span>')
    body = body.replace(
        '<span class="crumb">Voices › New voice</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'voices\')">Voices</span> › New voice</span>')
    body = body.replace(
        '<span class="crumb">Lexicons › Harbor names</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'lexicons\')">Lexicons</span> › Harbor names</span>')
    body = body.replace(
        '<span class="crumb">Effects › June’s chain</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'effects\')">Effects</span> › June’s chain</span>')
    # Voice library rows and the New-voice door should actually go somewhere.
    body = body.replace('<b style="color:var(--accent-ink);text-decoration:underline">',
                        '<b class="lnk" onclick="nav(\'workbench\')">')
    # The Scene pill used to be rewritten here. It now lives directly in
    # _s4.html, because Render owns the performance layer and therefore the
    # scene door. The rule that was here matched an exact string the 2026-08-16
    # Render restructure deleted, so it silently stopped firing and `scene` was
    # an unreachable route for six days (found 2026-08-22). Put a link in the
    # screen, not in a rewrite rule that fails quietly. validate.py's
    # "routes nothing links to" line is the check that catches this class.
    # Kind pills follow whichever project is open.
    body = body.replace('<span class="pill">Kind 📖 <b>audiobook</b> ▾</span>',
                        '<span class="pill proj-kind">📖 audiobook</span>')
    # New voice door + cast rows reach the maker screens.
    body = body.replace('<button class="btn p">＋ New voice</button>',
                        '<button class="btn p" onclick="nav(\'newvoice\')">＋ New voice</button>')
    body = body.replace('<button class="btn">🔀 Blend with…</button>',
                        '<button class="btn" onclick="nav(\'newvoice\')">🔀 Blend with…</button>')
    body = body.replace('<button class="btn">🧪 Train a LoRA</button>',
                        '<button class="btn" onclick="nav(\'newvoice\')">🧪 Train a LoRA</button>')
    body = body.replace('<button class="btn s g">Change in Cast →</button>',
                        '<button class="btn s g" onclick="nav(\'cast\')">Change in Cast →</button>')
    body = body.replace('<button class="btn">📕 Fix a pronunciation</button>',
                        '<button class="btn" onclick="nav(\'lexicons\')">📕 Fix a pronunciation</button>')
    body = body.replace('<button class="btn s g">＋ Edit chain</button>',
                        '<button class="btn s g" onclick="nav(\'effects\')">＋ Edit chain</button>')
    body = body.replace('<button class="btn s g">＋ Edit</button>',
                        '<button class="btn s g" onclick="nav(\'effects\')">＋ Edit</button>')
    return body


ROUTES = [
    ("home",      new("home")),
    ("projects",  new("projects")),
    ("new",       stash(1)),
    ("overview",  inject_steps(new("overview"), "overview")),
    ("discover",  inject_steps(new("discover"), "discover")),
    ("chapters",  inject_steps(new("chapters"), "script")),
    ("lines",     inject_steps(new("lines"), "script")),
    ("chapter",   inject_steps(linkify(stash(2)), "script")),
    ("cast",      inject_steps(linkify(stash(3)), "cast")),
    ("render",    inject_steps(linkify(stash(4)), "render")),
    ("export",    inject_steps(linkify(stash(5)), "export")),
    ("personas",  linkify(stash(9))),
    ("voices",    linkify(stash(6))),
    ("workbench", linkify(stash(7))),
    ("newvoice",  linkify(stash(8))),
    ("lexicons",  linkify(stash(10))),
    ("effects",   linkify(stash(11))),
    ("scene",     linkify(stash(12))),
    ("engines",   linkify(stash(13))),
]

SCRIPT = """
<script>
var KIND = {
  audiobook: '\\uD83D\\uDCD6 audiobook',
  game: '\\uD83C\\uDFAE game voicelines',
  podcast: '\\uD83C\\uDF99\\uFE0F podcast'
};

function nav(route) {
  var el = document.getElementById('r-' + route);
  if (!el) return;
  document.querySelectorAll('.route').forEach(function (r) { r.classList.remove('on'); });
  el.classList.add('on');
  document.querySelectorAll('.rail i').forEach(function (i) {
    // A rail item lights for every route it owns; Studio owns all its steps.
    i.classList.toggle('on', (i.dataset.r || '').split(' ').indexOf(route) !== -1);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openProject(kind, name) {
  document.body.setAttribute('data-kind', kind);
  document.querySelectorAll('.proj-name').forEach(function (n) { n.textContent = name; });
  document.querySelectorAll('.proj-kind').forEach(function (n) { n.innerHTML = KIND[kind]; });
  // A kind has its own chapter rows, so the run buttons are counted again.
  recalcAll();
  nav('overview');
}

document.body.setAttribute('data-kind', 'audiobook');
// The estimate is computed from the boxes that start ticked, never hardcoded.
recalcAll();
nav('home');
</script>
"""

parts = [head, EXTRA_CSS, IX.CSS, '\n<div class="shell">\n<div class="app">\n', RAIL, '\n<div class="pane">\n']
for rid, body in ROUTES:
    parts.append('<div class="route" id="r-%s">\n%s\n</div>\n' % (rid, body))
parts.append("</div>\n</div>\n</div>\n")
parts.append(IX.MODALS)
parts.append(SCRIPT.replace("<script>", "<script>" + IX.JS, 1))

out = "".join(parts)
(SP / "workbench-mock.html").write_text(out, encoding="utf-8", newline="\n")
print("routes:", len(ROUTES), "| lines:", out.count("\n") + 1)
