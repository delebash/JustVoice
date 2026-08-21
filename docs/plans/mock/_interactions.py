"""Interaction layer for the mock: modals, toasts, chips, radios, row expansion."""

CSS = """
<style>
/* Modal */
.mask{position:fixed;inset:0;background:rgba(20,22,24,.42);z-index:200;display:none;
  align-items:flex-start;justify-content:center;padding:56px 18px;overflow:auto}
.mask.on{display:flex}
.modal{background:var(--surface);border:1px solid var(--line-strong);border-radius:12px;
  box-shadow:var(--shadow-3);width:100%;max-width:680px}
.modal.wide{max-width:900px}
.modal-h{display:flex;align-items:baseline;gap:9px;padding:14px 18px;border-bottom:1px solid var(--line)}
.modal-h h3{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}
.modal-h .eb{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.modal-b{padding:16px 18px;display:flex;flex-direction:column;gap:13px}
.modal-f{display:flex;align-items:center;gap:9px;padding:12px 18px;border-top:1px solid var(--line)}
.xbtn{margin-left:auto;border:0;background:transparent;font-size:17px;color:var(--ink-3);cursor:pointer;line-height:1}
.xbtn:hover{color:var(--ink)}

/* Toast */
#toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:300;
  display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.tst{background:var(--ink);color:var(--bg);font-size:12.5px;font-weight:600;padding:9px 15px;
  border-radius:var(--r-pill);box-shadow:var(--shadow-3);max-width:520px}
.tst.ok{background:var(--accent);color:#fff}
.tst.warn{background:var(--gold);color:#241c05}

/* Scope picker */
.scope{border:1px solid var(--line);border-radius:var(--r-card);max-height:230px;overflow:auto}
.scope label{display:flex;align-items:center;gap:9px;padding:7px 11px;border-bottom:1px solid var(--line);
  font-size:12.5px;cursor:pointer}
.scope label:last-child{border-bottom:0}
.scope label:hover{background:var(--surface-2)}
.scope .nm{flex:1;font-weight:600}
.est{display:flex;gap:16px;flex-wrap:wrap;padding:10px 12px;background:var(--surface-2);
  border:1px solid var(--line);border-radius:var(--r-control)}
.est div{display:flex;flex-direction:column;gap:2px}
.est .v{font-family:var(--font-mono);font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.est .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);font-weight:700}
.hidden-row{display:none!important}

/* Non-button controls: rows and glyphs. These looked interactive and did nothing
   until 2026-08-17, because validate.py only ever counted button elements. */
tbody tr[onclick]{cursor:pointer}
tbody tr[onclick]:hover{background:var(--surface-2)}
.rt span[onclick]{cursor:pointer;padding:0 2px;border-radius:4px}
.rt span[onclick]:hover{color:var(--ink);background:var(--surface-3)}
.rt span.off{opacity:.3;cursor:not-allowed}
.rt span.off:hover{background:transparent;color:inherit}

/* The direction cell is edited in the row, not in an expansion -- over 214 lines
   that is the difference between usable and not. Reads as text, becomes an input
   on focus, so 214 rows are not 214 live textareas. */
.cell-edit{width:100%;border:1px solid transparent;background:transparent;font:inherit;
  color:var(--ink);padding:3px 5px;border-radius:var(--r-control)}
.cell-edit::placeholder{color:var(--ink-3);font-style:italic}
.cell-edit:hover:not(:disabled){border-color:var(--line);background:var(--surface-2)}
.cell-edit:focus{border-color:var(--accent);background:var(--surface);outline:none}
.cell-edit:disabled{color:var(--ink-3);cursor:not-allowed;font-size:11px}
.cell-tags{display:flex;gap:4px;flex-wrap:wrap;align-items:center;cursor:pointer;
  padding:3px 5px;border:1px solid transparent;border-radius:var(--r-control);min-height:24px}
.cell-tags:hover{border-color:var(--line);background:var(--surface-2)}
</style>
"""

MODALS = """
<div class="mask" id="mask" onclick="if(event.target===this)closeModal()">

  <!-- Compare takes -->
  <div class="modal wide" id="m-compare" style="display:none">
    <div class="modal-h"><span class="eb">Line 2 · June</span><h3>Compare takes</h3>
      <button class="xbtn" onclick="closeModal()">✕</button></div>
    <div class="modal-b">
      <div class="split2">
        <div class="card"><div class="sh"><h4>★ Live · take 3</h4></div>
          <div class="player"><button class="btn p s rnd" onclick="toast(&quot;Playing take…&quot;)">▶</button><div class="bar"><b style="width:0"></b></div>
            <span class="mono hint">0:02</span></div>
          <p class="hint" style="margin:8px 0 0">1.05× · “Sharp, clipped, edge of irritation.” · seed 8812</p></div>
        <div class="card"><div class="sh"><h4>take 2</h4></div>
          <div class="player"><button class="btn p s rnd" onclick="toast(&quot;Playing take…&quot;)">▶</button><div class="bar"><b style="width:0"></b></div>
            <span class="mono hint">0:02</span></div>
          <p class="hint" style="margin:8px 0 0">1.00× · no direction · seed 4471</p>
          <button class="btn s" style="margin-top:9px" onclick="toast('Take 2 promoted — it is now the live take.','ok');closeModal()">★ Make this the live take</button></div>
      </div>
      <div class="bn">Both takes are kept. Promoting swaps which one the chapter renders with; nothing
        is deleted until you delete it.</div>
    </div>
    <div class="modal-f"><span style="flex:1"></span>
      <button class="btn" onclick="closeModal()">Close</button></div>
  </div>

  <!-- Add effect -->
  <div class="modal" id="m-effect" style="display:none">
    <div class="modal-h"><span class="eb">June’s chain</span><h3>Add an effect</h3>
      <button class="xbtn" onclick="closeModal()">✕</button></div>
    <div class="modal-b">
      <div class="map">
        <div class="mc" style="cursor:pointer" onclick="toast('Reverb added to June’s chain.','ok');closeModal()">
          <div class="n">Reverb</div><div class="d">Room size, damping, wet mix.</div></div>
        <div class="mc" style="cursor:pointer" onclick="toast('EQ added to June’s chain.','ok');closeModal()">
          <div class="n">EQ</div><div class="d">Low, mid and high shelves.</div></div>
        <div class="mc" style="cursor:pointer" onclick="toast('Compressor added to June’s chain.','ok');closeModal()">
          <div class="n">Compressor</div><div class="d">Threshold, ratio, attack, release.</div></div>
        <div class="mc" style="cursor:pointer" onclick="toast('Gain added to June’s chain.','ok');closeModal()">
          <div class="n">Gain</div><div class="d">A flat level trim, in dB.</div></div>
        <div class="mc" style="cursor:pointer" onclick="toast('Pitch shift added to June’s chain.','ok');closeModal()">
          <div class="n">Pitch shift</div><div class="d">Semitones, post-process.</div></div>
        <div class="mc" style="cursor:pointer" onclick="toast('Low-pass added to June’s chain.','ok');closeModal()">
          <div class="n">Low-pass</div><div class="d">Cutoff — the “heard through a door” one.</div></div>
      </div>
    </div>
    <div class="modal-f"><span style="flex:1"></span><button class="btn" onclick="closeModal()">Cancel</button></div>
  </div>

  <!-- Row menu — the ⋯ on a library row -->
  <div class="modal" id="m-rowmenu" style="display:none">
    <div class="modal-h"><span class="eb">June</span><h3>Persona actions</h3>
      <button class="xbtn" onclick="closeModal()">✕</button></div>
    <div class="modal-b">
      <div class="row"><button class="btn" onclick="toast('Renaming June — the name changes everywhere she speaks.','ok');closeModal()">✏️ Rename</button>
        <button class="btn" onclick="toast('Pick the persona to merge June into — her lines move across.');closeModal()">🔗 Merge into…</button>
        <button class="btn d" onclick="toast('June speaks 115 lines in 2 projects — delete refuses while she is cast.','warn');closeModal()">🗑 Delete</button></div>
      <div class="bn">A persona is library-level, so these act everywhere she is used — not just in
        the project you came from. Deleting refuses while she still has lines.</div>
    </div>
    <div class="modal-f"><span style="flex:1"></span><button class="btn" onclick="closeModal()">Cancel</button></div>
  </div>

  <!-- Turbo's tag picker, opened from the direction cell -->
  <div class="modal" id="m-tags" style="display:none">
    <div class="modal-h"><span class="eb">Line 41 &middot; Marius &middot; Chatterbox Turbo</span>
      <h3>How is it said?</h3><button class="xbtn" onclick="closeModal()">&#10005;</button></div>
    <div class="modal-b">
      <div class="f"><label>Emotion <span class="tag">Turbo's own 7</span></label>
        <div class="radios">
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>angry</span>
          <span class="radio on" onclick="pickRadio(this)"><span class="rd"></span>fear</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>happy</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>sarcastic</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>surprised</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>crying</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>whispering</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>&mdash; none &mdash;</span></div></div>
      <div class="f"><label>Register</label>
        <div class="radios">
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>narration</span>
          <span class="radio on" onclick="pickRadio(this)"><span class="rd"></span>dramatic</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>advertisement</span>
          <span class="radio" onclick="pickRadio(this)"><span class="rd"></span>&mdash; none &mdash;</span></div></div>
      <div class="bn">Non-verbal sounds &mdash; <span class="mono">[sigh]</span>,
        <span class="mono">[laugh]</span> &mdash; are not set here. They go at a point
        <i>inside</i> the sentence, so you insert them in the line's text.</div>
    </div>
    <div class="modal-f"><span class="hint">Turbo only. Chatterbox Multilingual reads these as words.</span>
      <span style="flex:1"></span><button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn p" onclick="toast('[fear] [dramatic] set on line 41.','ok');closeModal()">Set</button></div>
  </div>

  <!-- Add a lexicon word -->
  <div class="modal" id="m-word" style="display:none">
    <div class="modal-h"><span class="eb">Harbor names</span><h3>Add a pronunciation</h3>
      <button class="xbtn" onclick="closeModal()">✕</button></div>
    <div class="modal-b">
      <div class="kb k2">
        <div class="f"><label>Word</label><input class="box" value="Hecate"></div>
        <div class="f"><label>Notation</label><select class="box"><option>Phonetic</option><option>IPA</option></select></div>
      </div>
      <div class="f"><label>Say it as</label><input class="box mono" value="HEH-kuh-tee"></div>
      <div class="row"><select class="box" style="flex:1"><option>Hear it as June</option>
        <option>Hear it as Narrator</option></select><button class="btn s p" onclick="toast(&quot;Hearing it as the engine says it now.&quot;)">▶ Before</button>
        <button class="btn s p" onclick="toast(&quot;Hearing it with your pronunciation.&quot;)">▶ After</button></div>
      <div class="bn w">IPA only works on engines with phoneme input — Kokoro yes, Chatterbox no.</div>
    </div>
    <div class="modal-f"><span class="hint">37 lines contain this word; they become stale, not re-rendered.</span>
      <span style="flex:1"></span><button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn p" onclick="toast('Hecate added — 37 lines marked stale.','ok');closeModal()">Add</button></div>
  </div>

</div>
<div id="toast"></div>
"""

JS = """
function openModal(id) {
  document.querySelectorAll('.modal').forEach(function (m) { m.style.display = 'none'; });
  var m = document.getElementById('m-' + id);
  if (m) m.style.display = 'block';
  document.getElementById('mask').classList.add('on');
}
function closeModal() { document.getElementById('mask').classList.remove('on'); }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

function toast(msg, kind) {
  var box = document.getElementById('toast');
  var t = document.createElement('div');
  t.className = 'tst' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(function () { t.remove(); }, 3200);
}

function pickRadio(el) {
  var group = el.parentElement;
  group.querySelectorAll('.radio').forEach(function (r) { r.classList.remove('on'); });
  el.classList.add('on');
}

function pickChip(el) {
  var group = el.parentElement;
  group.querySelectorAll('.tag[data-filter]').forEach(function (c) { c.classList.remove('ok'); });
  el.classList.add('ok');
  var want = el.dataset.filter;
  var host = group.closest('.body').querySelector('[data-filterable]');
  if (!host) return;
  var rows = host.querySelectorAll('tbody tr[data-state], .ln[data-state]');
  var shown = 0;
  rows.forEach(function (r) {
    var hit = want === 'all' || r.dataset.state === want;
    r.classList.toggle('hidden-row', !hit);
    if (hit) shown++;
  });
  toast(shown + (shown === 1 ? ' line' : ' lines') + ' shown');
}

/* Analyze / Discover scope */
var SCOPE_CH = [
  { n: 1, lines: 214 }, { n: 2, lines: 188 }, { n: 3, lines: 231 },
  { n: 4, lines: 176 }, { n: 5, lines: 203 }, { n: 6, lines: 198 }
];

/* Selecting chapters recalculates in place -- no modal, no radios. The three radios
   were presets for these checkboxes, which is why they were redundant furniture.
   Discover and Script both carry this grid, so everything is scoped to its own route. */
function chScope(el) {
  return (el && el.closest && el.closest('.route')) ||
         document.querySelector('.route.on') || document;
}
function selectAllCh(box) {
  var r = chScope(box);
  r.querySelectorAll('.ck').forEach(function (b) { b.checked = box.checked; });
  recalcAnalyze(box);
}
function recalcAnalyze(el) {
  var r = chScope(el);
  var boxes = Array.prototype.slice.call(r.querySelectorAll('.ck'));
  var picked = boxes.map(function (b, i) { return b.checked ? SCOPE_CH[i] : null; }).filter(Boolean);
  var all = r.querySelector('.ch-all');
  if (all) {
    all.checked = picked.length === boxes.length;
    all.indeterminate = picked.length > 0 && picked.length < boxes.length;
  }
  var ln = picked.reduce(function (a, c) { return a + c.lines; }, 0);
  var secs = Math.max(1, Math.ceil(ln / 80)) * 33;
  var mins = (secs >= 60 ? Math.floor(secs / 60) + 'm ' : '') + (secs % 60) + 's';
  var btn = r.querySelector('.an-btn');
  var est = r.querySelector('.an-est');
  if (btn) {
    btn.textContent = btn.dataset.verb + (picked.length
      ? ' ' + picked.length + (picked.length === 1 ? ' chapter' : ' chapters') : '');
    btn.disabled = picked.length === 0;
  }
  if (est) {
    est.textContent = picked.length
      ? ln.toLocaleString() + ' lines \u00b7 about ' + mins + ' \u00b7 ' + est.dataset.tail
      : 'Pick at least one chapter.';
  }
}
/* A SECOND recalcAnalyze used to sit here and overwrote the scoped one above.
   It queried #chGrid / #chAll / #anBtn / #anEst, none of which exist anywhere in
   the built file, so ticking a chapter updated nothing. Deleted 2026-08-17. */

/* A glyph inside a row must not also fire the row's own click. */
document.addEventListener('click', function (e) {
  if (e.target.closest && e.target.closest('.rt')) e.stopPropagation();
}, true);

/* Cast: select a speaker card, then click a persona to assign it. */
function pickCard(el) {
  var scope = el.closest('.route') || document;
  scope.querySelectorAll('.spkcard').forEach(function (c) { c.classList.remove('sel'); });
  el.classList.add('sel');
  var name = (el.querySelector('.nm') || {}).textContent || 'speaker';
  toast(name + ' selected — click a persona to assign it.');
}

/* Chevrons really open and close the expansion row that follows. */
function toggleRow(el) {
  var tr = el.closest('tr');
  if (!tr) return;
  var next = tr.nextElementSibling;
  if (!next || !(next.classList.contains('castx') || next.classList.contains('exp'))) {
    toast('Nothing more to show on this row.');
    return;
  }
  var opening = next.classList.contains('hidden-row');
  next.classList.toggle('hidden-row', !opening);
  el.textContent = opening ? '\u2303' : '\u2304';
}

/* The Personas index opens the SAME editor a Cast row opens - one editor, two
   doors (redesign 8.3a). Drawing a second one is what made it read as two systems. */
function openPersona(row) {
  var cell = row.querySelector('.spk');
  var name = cell ? cell.textContent.trim() : 'This persona';
  nav('cast');
  toast(name + ' \u2014 the same editor the Cast row opens.', 'ok');
}

"""
