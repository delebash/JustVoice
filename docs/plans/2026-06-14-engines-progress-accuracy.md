# Engines: accurate progress across download + extract + setup phases

**Authored 2026-06-14 (busy-rubin).** User-reported via screenshot of Kokoro
v0.19 mid-fetch: bar shows 45% in `EXTRACTING-MODEL` with no MB / MB·s /
ETA. That's not "the renderer is wrong" — it's that the **server stops
reporting bytes the moment phase flips to `extracting`**, the bar then
either freezes or falls back to a placeholder width, and the metrics row
hides because `bytes_total <= 0`. So the bar is lying in multiple ways:
fake percentage, no real number anywhere, "extracting" with no movement.

**User rulings (locked, 2026-06-14):**

1. **One smooth bar through download AND extract.** Bar never resets when
   phase flips. Server reports a single `(work_done, work_total)` where
   download bytes + extract bytes both count as work. Phase pill still
   says "extracting" so the user knows what's happening — the bar just
   keeps moving honestly.
2. **Sweep ALL progress code paths**, not just kokoro. Same shape for
   every install/download/setup the user sees.

---

## Code paths in scope (audit first, then unify)

- **A** `installer.spawn_install` (legacy kokoro) → calls `_run_install` →
  `_stream_download` + `_extract_tar_bz2`. The path the screenshot exercises.
- **B** `installer.spawn_prefetch._url_stream_to` (S1's kokoro path) →
  `_stream_download` + `_extract_tar_bz2`. Same primitives as A, same bug.
- **C** `installer.spawn_prefetch._hf_snapshot_to` (S1's HF path) →
  `huggingface_hub.snapshot_download` with tqdm hook. **No extract step**
  (HF cache layout is already file-by-file). Audit: confirm the tqdm
  hook's totals are right; currently `bytes_total` is set from the
  manifest's `size_mb` BEFORE the worker starts, and the hook only sums
  `tqdm.update(n)` deltas — needs verification that the two agree.
- **D** `installer.spawn_managed_install` (venv build) → pip subprocess.
  Currently emits `phase` + `current_file` (latest pip line) but no
  bytes. Per the user rule, the bar should be *honestly indeterminate*
  during pip — the C3 strip already supports that (animated stripes when
  `bytes_total <= 0`); the audit just confirms the strip handles it
  cleanly and doesn't paint a fake percentage.
- **E** `manager.load` progress (subprocess startup → loading_weights →
  warming_up). Same shape as D — emits `phase` only, no bytes.
  Indeterminate is correct here too; verify.

## Server contract changes

### P0 — Two new job-state fields with one merged % meaning

Today `JobStatus` has `bytes_downloaded` and `bytes_total`. We KEEP both
for backward compat (older clients still read them), but extend them to
mean **work units done / total**, not just download bytes:

- Add helper `_estimate_archive_unpacked(archive_path) -> int`. For a
  `.tar.bz2` / `.tar.gz` we open the tar, sum every `tarinfo.size`. This
  is the only honest "total extract bytes" number; no constants/guesses.
- The worker computes `download_total + estimated_unpacked` BEFORE
  starting download — sets `bytes_total` to that combined figure.
- During download, `bytes_downloaded` advances by streamed bytes
  (unchanged shape; semantically now "work done").
- When phase flips to `extracting`, the worker extracts member by
  member, incrementing `bytes_downloaded += member.size` after each one.
  `tarfile` exposes `getmembers()` which yields TarInfo objects with
  `.size` — extract them in order with `tar.extract(member, dest)`.

This makes the bar move smoothly through both phases. The phase pill
still flips so the user knows extract is happening; the bar just doesn't
reset or freeze.

### P1 — Audit the HF tqdm hook

The S1 `_Reporter` class in `_hf_snapshot_to` already accumulates byte
deltas across files (`cumulative["bytes"] += self.n` on exit). Verify:

- The pre-set `bytes_total` (from manifest size_mb) is in BYTES, and
  the tqdm hook's running total also reports bytes — units match.
  (Reading the current code: `bytes_total = size_mb * 1024 * 1024` ✓;
  tqdm's `n` is `bytes` for snapshot_download's file downloads ✓.)
- If real total ends up larger than the manifest estimate (real wheels
  often are), the bar would exceed 100%. Cap it at `bytes_total` in the
  reporter OR `Math.min(100, …)` in the renderer (already there).
  Decision: belt + suspenders — cap server-side too, log a warning if
  the estimate was off by > 20%.

### P2 — Honest indeterminate for byte-less phases

`spawn_managed_install` (pip), `manager.load` (subprocess startup):
these legitimately don't have a bytes number. The server should
**explicitly set `bytes_total = 0` and `bytes_downloaded = 0`** for the
whole job and rely on the C3 strip's `data-phase` indeterminate
animation. Today: pip path sets `bytes_total = 0` ✓; load path doesn't
emit job rows for the renderer's install/download strip at all — it
goes through a different task-strip pattern. Out of scope for this
plan; the engines-page progress strip is the deliverable.

## Client (renderer) contract changes

### R0 — Stop painting a fake bar when bytes_total <= 0

Today `EnginesView` strip markup:

```vue
<i :style="{ width: (row.value.bytes_total > 0 ? pct(row.value) : 35) + '%' }" />
```

The `35` is a placeholder that *looks like* 35% progress to the user.
With P2 setting `bytes_total = 0` for honestly-indeterminate phases
and our `.jv-install-strip[data-phase=connecting/extracting]` already
having stripe animation, the bar should be:

- **bytes_total > 0** → show the bar at `pct()`, show the MB / MB·s /
  ETA row.
- **bytes_total === 0** → bar is full-width animated stripes
  (indeterminate); metrics row reads just the phase + `current_file`,
  no fake numbers.

### R1 — Strip the "extracting" stripe override

Today `data-phase="extracting"` triggers stripes. With P0 making extract
report real bytes (work units), the user's bar IS moving — we don't want
stripe animation hiding that. Change CSS: stripes apply only when
`bytes_total === 0` (truly indeterminate), regardless of phase.

### R2 — Show extract phase in the bytes counter

When `phase === "extracting"` and `bytes_total > 0`, the counter row
can read `512 / 720 MB · extracting` so the user understands why the
file row may show an archive member path. Bytes counter shape
unchanged; just the visual cue.

## Verification (committed)

Extend `scripts/verify-engines-c3.mjs` (or a new
`verify-engines-progress.mjs`) to cover:

- Download phase: bytes counter shows fractional progress, bar width
  matches.
- Extract phase: bytes counter STILL shows MB done / total (the merged
  unit); bar continues past download point; phase pill reads
  "extracting"; bar does NOT show the indeterminate stripe.
- Indeterminate phase (mocked pip): bar shows stripes; no MB counter;
  no fake bar percentage.

For the server we add a focused test in
`tests/test_engine_sources_and_prefetch.py`:

- `_estimate_archive_unpacked` returns sum of tarinfo sizes for a small
  tarball we build in tmp.
- `_url_stream_to` with a mocked stream + extract reports a monotonic
  `bytes_downloaded` that advances through both phases against a
  `bytes_total = download + extract` combined number, then reaches the
  total exactly at completion.

## Execution queue (RULE #2 — single-item)

1. **A1** Server: add `_estimate_archive_unpacked` helper + per-member
   extract loop in `_extract_tar_bz2` (with state update).
2. **A2** Wire `bytes_total = download_total + estimated_unpacked` in
   `_url_stream_to` (S1) AND `_run_install` (legacy spawn_install).
3. **B1** Server: HF tqdm-hook audit — confirm units; cap > total
   server-side; log warning if estimate way off.
4. **R0/R1** Renderer: drop the `35` fake; gate stripes on
   `bytes_total === 0` instead of phase.
5. **R2** Renderer: show phase in the counter row when bytes_total > 0.
6. Tests: server (unit) + Playwright strip (committed).
7. Re-run all three engines suites + dialogs + no-fakes.

Estimated cost: ~250 LOC changed, ~6 commits per single-item rule.
