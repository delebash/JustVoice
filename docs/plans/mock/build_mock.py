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
/* How a speaker was decided — the five sources the pipeline can assign. */
.src{display:inline-block;margin-left:6px;font-size:9.5px;font-weight:700;letter-spacing:.03em;
  padding:1px 6px;border-radius:var(--r-pill);border:1px solid var(--line);color:var(--ink-3);
  background:var(--surface-2);vertical-align:middle;white-space:nowrap}
.src-tag{border-color:var(--accent-line);background:var(--accent-soft);color:var(--accent-ink)}
.src-llm{border-color:var(--line-strong);color:var(--ink-2)}
.src-floor{border-color:var(--danger-line);background:var(--danger-bg);color:var(--danger-ink)}
.rowacts .btn{margin-left:5px}

/* Script reads as a screenplay. Weight carries risk: narration recedes because it is
   never in question, a guess is marked whatever it scored, a flag is louder still. */
.scr{display:flex;flex-direction:column}
.scr .ln{display:grid;grid-template-columns:158px 1fr 26px;gap:13px;align-items:start;
  padding:8px 14px 8px 11px;border-bottom:1px solid var(--line);border-left:3px solid transparent;
  cursor:pointer;font-size:12.5px;line-height:1.5}
.scr .ln:hover{background:var(--surface-2)}
.scr .who{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;
  font-weight:650;font-size:11.5px;padding-top:1px}
.scr .txt{color:var(--ink)}
.scr .rt{opacity:0;transition:opacity .12s}
.scr .ln:hover .rt{opacity:1}
.scr .ln.narr{color:var(--ink-3)}
.scr .ln.narr .who,.scr .ln.narr .txt{color:var(--ink-3);font-weight:400}
.scr .ln.guess{border-left-color:var(--gold);background:var(--warn-bg)}
.scr .ln.flag{border-left-color:var(--danger);background:var(--danger-bg)}
.scr .ln.none{border-left-color:var(--danger);background:var(--danger-bg)}
.scr .ln.none .txt{font-weight:600}
.scr .ln.sel{outline:2px solid var(--accent);outline-offset:-2px}
.scr .why{display:block;margin-top:3px;font-size:10.5px;font-weight:700;color:var(--danger-ink)}

/* The two Studio models, switchable. */
body[data-studio="container"] .sv-flat{display:none!important}
body[data-studio="flat"] .sv-container{display:none!important}
.modebar{position:sticky;top:0;z-index:60;display:flex;gap:12px;align-items:center;flex-wrap:wrap;
  padding:9px 12px;margin-bottom:12px;background:var(--surface);border:1px solid var(--line-strong);
  border-radius:var(--r-pill);box-shadow:var(--shadow-1)}
.modebar .lbl{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
</style>
"""

RAIL = """<nav class="rail" aria-label="Main">
  <div class="gh">Work</div>
  <i data-r="home" onclick="nav('home')"><span class="e">&#127968;</span>Home</i>
  <i data-r="projects" onclick="nav('projects')"><span class="e">&#128193;</span>Projects</i>

  <i class="sv-container k-book" data-r="chapters" onclick="nav('chapters')"><span class="e">&#127916;</span>Studio</i>
  <i class="sv-container k-pod" data-r="chapters" onclick="nav('chapters')"><span class="e">&#127916;</span>Studio</i>
  <i class="sv-container k-game" data-r="lines" onclick="nav('lines')"><span class="e">&#127916;</span>Studio</i>

  <i class="sv-flat k-book" data-r="discover" onclick="nav('discover')"><span class="e">&#128269;</span>Discover</i>
  <i class="sv-flat k-pod" data-r="discover" onclick="nav('discover')"><span class="e">&#128269;</span>Discover</i>
  <i class="sv-flat k-book" data-r="chapters" onclick="nav('chapters')"><span class="e">&#128214;</span>Chapters</i>
  <i class="sv-flat k-pod" data-r="chapters" onclick="nav('chapters')"><span class="e">&#128214;</span>Episodes</i>
  <i class="sv-flat k-game" data-r="lines" onclick="nav('lines')"><span class="e">&#127918;</span>Voice&nbsp;lines</i>
  <i class="sv-flat" data-r="cast" onclick="nav('cast')"><span class="e">&#127917;</span>Cast</i>
  <i class="sv-flat" data-r="render" onclick="nav('render')"><span class="e">&#9889;</span>Render</i>
  <i class="sv-flat" data-r="export" onclick="nav('export')"><span class="e">&#11015;&#65039;</span>Export</i>

  <i class="dim" title="Not part of this redesign"><span class="e">&#127908;</span>Captures</i>
  <div class="gh">Library</div>
  <i data-r="voices" onclick="nav('voices')"><span class="e">&#127897;&#65039;</span>Voices</i>
  <i data-r="personas" onclick="nav('personas')"><span class="e">&#127917;</span>Personas</i>
  <i data-r="lexicons" onclick="nav('lexicons')"><span class="e">&#128213;</span>Lexicons</i>
  <i data-r="effects" onclick="nav('effects')"><span class="e">&#127899;&#65039;</span>Effects</i>
  <div class="gh">System</div>
  <i data-r="engines" onclick="nav('engines')"><span class="e">&#9881;&#65039;</span>AI</i>
  <i class="dim" title="Not part of this redesign"><span class="e">&#128295;</span>Settings</i>
</nav>"""


def steps(active):
    """Studio step strip — only exists in the container model."""
    def cls(key):
        return "stp on" if key == active else "stp"
    # Discover runs first because attribution can only pick personas that exist.
    # A game sheet already names its speakers, so it has no Discover and no Script.
    return (
        '    <div class="steps-strip sv-container">\n'
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
        '<span class="crumb"><span class="lnk" onclick="nav(\'chapters\')">'
        '<span class="proj-name">Stillwater</span></span> › Ch. 1 — The Ninth Door</span>')
    body = body.replace(
        '<span class="crumb">Stillwater › Cast</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'chapters\')">'
        '<span class="proj-name">Stillwater</span></span> › Cast</span>')
    body = body.replace(
        '<span class="crumb">Stillwater › Export</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'chapters\')">'
        '<span class="proj-name">Stillwater</span></span> › Export</span>')
    body = body.replace(
        '<span class="crumb">Ch. 1 › Render</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'chapter\')">Ch. 1</span> › Render</span>')
    body = body.replace(
        '<span class="crumb">Ch. 7 › Scene</span>',
        '<span class="crumb"><span class="lnk" onclick="nav(\'chapters\')">'
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
    # The chapter's Scene pill is the only way into the scene screen.
    body = body.replace('<span class="pill">Scene <b>no direction</b></span>',
                        '<span class="pill lnk" onclick="nav(\'scene\')" '
                        'style="text-decoration:none">Scene <b>no direction</b></span>')
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
    ("discover",  inject_steps(new("discover"), "discover")),
    ("chapters",  inject_steps(new("chapters"), "script")),
    ("lines",     inject_steps(new("lines"), "script")),
    ("chapter",   inject_steps(linkify(stash(2)), "script")),
    ("cast",      inject_steps(linkify(stash(3)), "cast")),
    ("render",    inject_steps(linkify(stash(4)), "render")),
    ("export",    inject_steps(linkify(stash(5)), "export")),
    ("voices",    linkify(stash(6))),
    ("workbench", linkify(stash(7))),
    ("newvoice",  linkify(stash(8))),
    ("personas",  linkify(stash(9))),
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
    i.classList.toggle('on', i.dataset.r === route);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openProject(kind, name) {
  document.body.setAttribute('data-kind', kind);
  document.querySelectorAll('.proj-name').forEach(function (n) { n.textContent = name; });
  document.querySelectorAll('.proj-kind').forEach(function (n) { n.innerHTML = KIND[kind]; });
  nav(kind === 'game' ? 'lines' : 'chapters');
}

function setStudio(model) {
  document.body.setAttribute('data-studio', model);
  document.getElementById('mCont').setAttribute('aria-pressed', String(model === 'container'));
  document.getElementById('mFlat').setAttribute('aria-pressed', String(model === 'flat'));
  document.getElementById('modeHint').textContent = model === 'container'
    ? 'Studio holds the five steps; the chapter list lives inside its Script step.'
    : 'No Studio. Discover, Chapters, Cast, Render and Export are each their own destination.';
}

document.body.setAttribute('data-kind', 'audiobook');
setStudio('container');
// The estimate is computed from the boxes that start ticked, never hardcoded.
document.querySelectorAll('.route').forEach(function (r) {
  if (r.querySelector('.ck')) recalcAnalyze(r.querySelector('.ck'));
});
nav('home');
</script>
"""

MODEBAR = """<div class="shell" style="padding-bottom:0">
  <div class="modebar">
    <span class="lbl">Studio model</span>
    <div class="seg" role="group" aria-label="Studio model">
      <button id="mCont" aria-pressed="true" onclick="setStudio('container')">Container</button>
      <button id="mFlat" aria-pressed="false" onclick="setStudio('flat')">Dissolved</button>
    </div>
    <span class="hint" id="modeHint">Studio holds the four steps; the chapter list lives inside its
      Script step.</span>
  </div>
</div>
"""

parts = [head, EXTRA_CSS, IX.CSS, MODEBAR, '\n<div class="shell">\n<div class="app">\n', RAIL, '\n<div class="pane">\n']
for rid, body in ROUTES:
    parts.append('<div class="route" id="r-%s">\n%s\n</div>\n' % (rid, body))
parts.append("</div>\n</div>\n</div>\n")
parts.append(IX.MODALS)
parts.append(SCRIPT.replace("<script>", "<script>" + IX.JS, 1))

out = "".join(parts)
(SP / "workbench-mock.html").write_text(out, encoding="utf-8", newline="\n")
print("routes:", len(ROUTES), "| lines:", out.count("\n") + 1)
