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

  <!-- Paste a chapter's text — the Script grid's "no text yet" row -->
  <div class="modal" id="m-paste" style="display:none">
    <div class="modal-h"><span class="eb">Ch. 13 · The Last Door</span><h3>Add its text</h3>
      <button class="xbtn" onclick="closeModal()">✕</button></div>
    <div class="modal-b">
      <p class="hint" style="margin:0">This chapter has no lines yet. Paste its text below (paragraphs
        become blocks, narrator-implied — assign speakers here in Script).</p>
      <textarea class="box" rows="8" placeholder="Paste the chapter text…"></textarea>
    </div>
    <div class="modal-f"><span style="flex:1"></span><button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn p" onclick="toast('Blocks added — tick the chapter to analyze it.','ok');closeModal()">Add as blocks</button></div>
  </div>

  <!-- Script chapter: the keyboard shortcuts -->
  <div class="modal" id="m-keys" style="display:none">
    <div class="modal-h"><span class="eb">Script</span><h3>Keyboard shortcuts</h3>
      <button class="xbtn" onclick="closeModal()">✕</button></div>
    <div class="modal-b">
      <p class="hint" style="margin:0">Everything here can also be done with the mouse. Click a line
        first to select it.</p>
      <div class="tw"><table><tbody>
        <tr><td style="width:150px" class="mono">j &nbsp; k</td><td>Next / previous spoken line</td></tr>
        <tr><td class="mono">n &nbsp; Shift+N</td><td>Next / previous line to check</td></tr>
        <tr><td class="mono">1 – 4</td><td>Give the line to 1 Marius · 2 June · 3 Renn · 4 Harbek — this
          chapter's speakers, most lines first</td></tr>
        <tr><td class="mono">0</td><td>Give the line to the Narrator</td></tr>
        <tr><td class="mono">Enter</td><td>This line looks right — it becomes yours</td></tr>
        <tr><td class="mono">Shift+Enter</td><td>Looks right, for every line sharing this line's mark</td></tr>
        <tr><td class="mono">Space</td><td>Tick or untick the line</td></tr>
        <tr><td class="mono">[ &nbsp; ]</td><td>Previous / next chapter</td></tr>
        <tr><td class="mono">Ctrl+Z</td><td>Undo your last change</td></tr>
      </tbody></table></div>
    </div>
    <div class="modal-f"><span style="flex:1"></span><button class="btn" onclick="closeModal()">Close</button></div>
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

/* A row can carry several states ("guess flag p-june"), and Script's speaker strip and
   filter chips are one group, so picking a speaker clears the filter and back. */
function pickChip(el) {
  var group = el.closest('[data-chips]') || el.parentElement;
  group.querySelectorAll('.tag[data-filter]').forEach(function (c) { c.classList.remove('ok'); });
  el.classList.add('ok');
  var want = el.dataset.filter;
  var host = group.closest('.body').querySelector('[data-filterable]');
  if (!host) return;
  var shown = filterRows(host, want);
  if (host.querySelector('.ck')) recalcAnalyze(host);
  var who = group.querySelector('select.spk-filter');
  if (who) who.value = 'all';
  toast(shown + (shown === 1 ? ' line' : ' lines') + ' shown');
}

function filterRows(host, want) {
  var shown = 0;
  host.querySelectorAll('tbody tr[data-state]').forEach(function (r) {
    var hit = want === 'all' || (r.dataset.state || '').split(' ').indexOf(want) !== -1;
    r.classList.toggle('hidden-row', !hit);
    if (hit && inKind(r)) shown++;
  });
  return shown;
}

/* A project kind hides the other kinds' variants (k-book / k-pod / k-game), so anything
   that counts rows has to skip the ones belonging to another kind. */
var KIND_CLASS = { audiobook: 'k-book', podcast: 'k-pod', game: 'k-game' };
function inKind(el) {
  var mine = KIND_CLASS[document.body.getAttribute('data-kind')] || 'k-book';
  for (var n = el; n && n !== document.body; n = n.parentElement) {
    var c = n.classList;
    if (c && (c.contains('k-book') || c.contains('k-pod') || c.contains('k-game')) &&
        !c.contains(mine)) return false;
  }
  return true;
}
function kindFirst(root, sel) {
  var all = root.querySelectorAll(sel);
  for (var i = 0; i < all.length; i++) if (inKind(all[i])) return all[i];
  return null;
}

/* Analyze / Discover scope. Selecting chapters recalculates in place -- no modal, no
   radios. The three radios were presets for these checkboxes, which is why they were
   redundant furniture. Discover and Script both carry this grid, so everything is scoped
   to its own route. Each box carries its own line count (data-lines). A disabled box (a
   chapter in the current run, or one with no text) is never picked. No time is estimated
   up front: nothing in the app measures it before a run. */
function chScope(el) {
  return (el && el.closest && el.closest('.route')) ||
         document.querySelector('.route.on') || document;
}
function selectAllCh(box) {
  var r = chScope(box);
  r.querySelectorAll('.ck').forEach(function (b) {
    var row = b.closest('tr');
    if (!b.disabled && inKind(b) && !(row && row.classList.contains('hidden-row'))) b.checked = box.checked;
  });
  recalcAnalyze(box);
}
function recalcAnalyze(el) {
  var r = chScope(el);
  var boxes = Array.prototype.slice.call(r.querySelectorAll('.ck')).filter(inKind);
  var open = boxes.filter(function (b) { return !b.disabled; });
  var picked = open.filter(function (b) { return b.checked; });
  /* The header box speaks for the chapters SHOWN: with a filter on, "select all" ticks
     only those, and a chapter ticked before the filter stays ticked and still counts. */
  var shown = open.filter(function (b) { var tr = b.closest('tr'); return !(tr && tr.classList.contains('hidden-row')); });
  var shownPicked = shown.filter(function (b) { return b.checked; });
  var all = r.querySelector('.ch-all');
  if (all) {
    all.checked = shown.length > 0 && shownPicked.length === shown.length;
    all.indeterminate = shownPicked.length > 0 && shownPicked.length < shown.length;
  }
  var ln = picked.reduce(function (a, b) { return a + (parseInt(b.dataset.lines, 10) || 0); }, 0);
  var btn = kindFirst(r, '.an-btn');
  var est = kindFirst(r, '.an-est');
  var unit = (btn && btn.dataset.unit) || 'chapter';
  if (btn) {
    btn.textContent = btn.dataset.verb + (picked.length
      ? ' ' + picked.length + ' ' + unit + (picked.length === 1 ? '' : 's') : '');
    btn.disabled = picked.length === 0;
  }
  if (est) {
    est.textContent = picked.length
      ? ln.toLocaleString() + ' lines \u00b7 ' + est.dataset.tail
      : 'Pick at least one ' + unit + '.';
  }
}
function recalcAll() {
  document.querySelectorAll('.route').forEach(function (r) {
    if (r.querySelector('.ck')) recalcAnalyze(r.querySelector('.ck'));
  });
}

/* Script chapter. It is the app's own table (ruled 2026-09-29, after two redesigns that
   hid the one control that matters): one row per line, a speaker dropdown on every row,
   column headings. A flagged line is tinted and says why in its Check column. Ticking
   rows is how several lines are changed at once. The keys are an extra, never the way. */
var SCR_KEYS = ['Marius', 'June', 'Renn', 'Harbek'];
function scrRoot() { return document.querySelector('#r-chapter .scrt'); }
function scrRows(sel) {
  var root = scrRoot();
  if (!root) return [];
  return Array.prototype.slice.call(root.querySelectorAll(sel)).filter(function (row) {
    return !row.classList.contains('hidden-row') && inKind(row);
  });
}
function scrCurrent() {
  var root = scrRoot();
  return root ? root.querySelector('tr.ln.sel') : null;
}
function scrSelect(row) {
  var root = scrRoot();
  if (!root || !row) return;
  root.querySelectorAll('tr.sel').forEach(function (r) { r.classList.remove('sel'); });
  row.classList.add('sel');
  if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}
function scrWords(row) { return row.querySelector('.q').textContent.trim(); }
/* A line you set or confirm is yours: Analyze leaves it alone and it is never flagged. */
function scrYours(row) {
  row.classList.remove('chk', 'none');
  row.dataset.state = (row.dataset.state || '').split(' ').filter(function (t) {
    return t !== 'check' && t !== 'none' && t !== 'changed';
  }).join(' ');
  row.querySelector('.by').innerHTML = '<span title="You set this one. Re-analyzing leaves it exactly as it is.">You</span>';
  row.querySelector('.cf').innerHTML = '<span class="hint">—</span>';
  row.querySelector('.ck').innerHTML = '';
}
function scrSet(select) {
  var row = select.closest('tr');
  var name = select.options[select.selectedIndex].text;
  var none = select.querySelector('option[value=""]');
  if (none) none.remove();
  scrYours(row);
  row.dataset.state = (row.dataset.state + ' p-' + select.value).trim();
  toast(scrWords(row) + ' → ' + name + '. Saved.', 'ok');
}
function scrAssign(name) {
  var row = scrCurrent();
  if (!row || row.classList.contains('mk')) { toast('Select a line first.'); return; }
  var select = row.querySelector('select');
  for (var i = 0; i < select.options.length; i++) {
    if (select.options[i].text === name) { select.selectedIndex = i; scrSet(select); return; }
  }
}
/* "OK" on a flagged line accepts every line that shares its flag. */
function scrOk(btn) {
  var row = btn.closest('tr');
  var grp = row.dataset.grp;
  var rows = grp ? scrRoot().querySelectorAll('tr[data-grp="' + grp + '"]') : [row];
  var n = rows.length;
  Array.prototype.forEach.call(rows, scrYours);
  toast('Looks right — ' + (n === 1 ? 'this line is' : 'these ' + n + ' lines are') +
    ' yours now, and the mark is gone.', 'ok');
}
/* "Show the lines around" on a marked line: every line comes back, and this one is
   selected, so the exchange can be read in order. */
function scrContext(btn) {
  var row = btn.closest('tr');
  var all = document.querySelector('#r-chapter [data-chips] .tag[data-filter="all"]');
  if (all && !all.classList.contains('ok')) pickChip(all);
  scrSelect(row);
  toast('Every line shown — read the lines around the selected one.');
}
function scrConfirm() {
  var row = scrCurrent();
  if (!row || row.classList.contains('mk')) { toast('Select a line first.'); return; }
  if (row.classList.contains('none')) { toast('This line has no speaker yet — pick one first.', 'warn'); return; }
  scrYours(row);
  toast('Confirmed — this line is yours now. Analyze leaves it alone.', 'ok');
}
function scrTicked() { return scrRows('tr.ln').filter(function (r) { var b = r.querySelector('.tk'); return b && b.checked; }); }
function scrTickAll(box) {
  scrRows('tr.ln').forEach(function (r) { var b = r.querySelector('.tk'); if (b) b.checked = box.checked; });
  scrTickCount();
}
function scrTickCount() {
  var n = scrTicked().length;
  var out = document.querySelector('#r-chapter .tick-n');
  if (out) out.textContent = n ? n + (n === 1 ? ' line ticked' : ' lines ticked') : 'Tick lines to change several at once.';
  document.querySelectorAll('#r-chapter .needs-tick').forEach(function (c) { c.disabled = n === 0; });
}
function scrBulkSet(select) {
  var rows = scrTicked();
  if (!select.value) return;
  var name = select.options[select.selectedIndex].text;
  rows.forEach(function (r) {
    var s = r.querySelector('select');
    if (!s) return;
    for (var i = 0; i < s.options.length; i++) if (s.options[i].text === name) s.selectedIndex = i;
    var none = s.querySelector('option[value=""]');
    if (none) none.remove();
    scrYours(r);
  });
  toast(rows.length + (rows.length === 1 ? ' line' : ' lines') + ' → ' + name + '. Saved.', 'ok');
  select.value = '';
}
function scrSwap() {
  var rows = scrTicked().filter(function (r) { return r.classList.contains('say'); });
  var names = [];
  rows.forEach(function (r) {
    var s = r.querySelector('select');
    var n = s.options[s.selectedIndex].text;
    if (names.indexOf(n) === -1) names.push(n);
  });
  if (names.length !== 2) {
    toast('Swap needs ticked lines spoken by exactly two personas — these have ' + names.length + '.', 'warn');
    return;
  }
  rows.forEach(function (r) {
    var s = r.querySelector('select');
    var want = s.options[s.selectedIndex].text === names[0] ? names[1] : names[0];
    for (var i = 0; i < s.options.length; i++) if (s.options[i].text === want) s.selectedIndex = i;
    scrYours(r);
  });
  toast('Swapped ' + names[0] + ' and ' + names[1] + ' across ' + rows.length + ' lines. Saved.', 'ok');
}
function scrMarkRight() {
  var rows = scrTicked().filter(function (r) { return !r.classList.contains('none') && !r.classList.contains('mk'); });
  rows.forEach(scrYours);
  toast('Confirmed — ' + rows.length + (rows.length === 1 ? ' line is' : ' lines are') + ' yours now.', 'ok');
}
function scrMove(step, sel) {
  var list = scrRows(sel);
  if (!list.length) { toast('Nothing to check in this view.'); return; }
  var cur = scrCurrent();
  var next = null;
  var i = list.indexOf(cur);
  if (i !== -1) {
    next = list[i + step] || null;
  } else {
    /* The selection is not in this list: take the nearest one in reading order. */
    var all = scrRows('tr.ln');
    var at = all.indexOf(cur);
    for (var k = 0; k < list.length; k++) {
      var pos = all.indexOf(list[k]);
      if (step > 0 && pos > at) { next = list[k]; break; }
      if (step < 0 && pos < at) next = list[k];
    }
  }
  if (!next) {
    toast(step > 0 ? 'That was the last one in this chapter.' : 'That was the first one in this chapter.');
    return;
  }
  scrSelect(next);
}
function scrNext(step) { scrMove(step, 'tr.ln.chk, tr.ln.none'); }
/* A link into Script lands on the problem: the chapter, filtered when asked, with the
   first line of that kind selected (the grid's Review, Render's "fix in Script"). */
function openScriptAt(filter, selectFirst) {
  nav('chapter');
  if (filter) {
    var chip = document.querySelector('#r-chapter .tag[data-filter="' + filter + '"]');
    if (chip) pickChip(chip);
  }
  if (selectFirst) {
    var first = scrRows(filter === 'none' ? 'tr.ln.none' : 'tr.ln.chk, tr.ln.none')[0];
    if (first) scrSelect(first);
  }
}
function openGridAt(filter) {
  nav('chapters');
  var chip = document.querySelector('#r-chapters .tag[data-filter="' + filter + '"]');
  if (chip) pickChip(chip);
}
function pickSpeaker(select) {
  var group = select.closest('[data-chips]');
  var host = select.closest('.body').querySelector('[data-filterable]');
  group.querySelectorAll('.tag[data-filter]').forEach(function (c) {
    c.classList.toggle('ok', select.value === 'all' && c.dataset.filter === 'all');
  });
  var shown = filterRows(host, select.value);
  toast(shown + (shown === 1 ? ' line' : ' lines') + ' shown');
}
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t.closest) return;
  var row = t.closest('#r-chapter .scrt tr.ln');
  if (row && !row.classList.contains('mk')) scrSelect(row);
  if (t.classList && t.classList.contains('tk')) scrTickCount();
});
document.addEventListener('keydown', function (e) {
  var route = document.getElementById('r-chapter');
  if (!route || !route.classList.contains('on')) return;
  var t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (document.getElementById('mask').classList.contains('on')) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') {
      toast('Undone — your last change is back as it was.', 'ok');
      e.preventDefault();
    }
    return;
  }
  if (e.altKey) return;
  var k = e.key;
  if (k === 'j') scrMove(1, 'tr.ln.say');
  else if (k === 'k') scrMove(-1, 'tr.ln.say');
  else if (k === 'n') scrNext(1);
  else if (k === 'N') scrNext(-1);
  else if (k === ']') toast('Opens 2 · Salt and Ledger.');
  else if (k === '[') toast('This is the first chapter.');
  else if (k === ' ') {
    var cur = scrCurrent();
    var box = cur && cur.querySelector('.tk');
    if (box) { box.checked = !box.checked; scrTickCount(); }
  } else if (k === 'Enter') {
    var here = scrCurrent();
    var ok = here && here.querySelector('.ck button');
    if (e.shiftKey && ok) scrOk(ok); else scrConfirm();
  } else if (k >= '1' && k <= '9') {
    var name = SCR_KEYS[parseInt(k, 10) - 1];
    if (name) scrAssign(name); else toast('No persona is on ' + k + ' in this chapter.');
  } else if (k === '0') {
    scrAssign('Narrator');
  } else return;
  e.preventDefault();
});

/* A SECOND recalcAnalyze used to sit here and overwrote the scoped one above.
   It queried #chGrid / #chAll / #anBtn / #anEst, none of which exist anywhere in
   the built file, so ticking a chapter updated nothing. Deleted 2026-08-17. */

/* A glyph inside a row must not also fire the row's own click: stop the click at the
   glyph's .rt wrapper, AFTER the glyph's own handler has run. Until 2026-09-29 this was a
   capture-phase listener on document, which stopped the click BEFORE it reached the glyph,
   so no glyph control in the mock ever fired - and validate.py, which only looks for the
   onclick attribute, counted all of them as working. Found by clicking one. */
document.querySelectorAll('.rt').forEach(function (rt) {
  rt.addEventListener('click', function (e) { e.stopPropagation(); });
});

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
