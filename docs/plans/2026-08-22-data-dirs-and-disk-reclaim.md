# 2026-08-22 — The two data dirs, the disk reclaim, and what the size numbers mean

**Read this before touching the data dir, the disk-usage panel, the HF model
cache, or the smoke gate's `--data-dir` flag.** Everything here was measured on
the user's real machine on 2026-08-22, not inferred. Nothing in it needs
re-deriving.

Origin: the user said **"clean it up"**, then **"your rec go"** on a three-item
recommendation, then **"code it go"** on the defect the cleanup exposed.

---

## 1. What actually happened

Housekeeping that turned into three corrections and one real bug fix:

| # | Item | Outcome |
|---|---|---|
| 1 | Delete the stale `<repo>/data` root | **Done** — 1.18 GB, after rescuing two voices from it |
| 2 | Reinstall the "stale" global `justvoice-server` | **Not needed** — it was already correct |
| 3 | Reclaim the duplicated HF model cache | **Done** — 22.32 GB, by hardlink |
| 4 | Leave the ~49 GB data dir where it is | **Left** — the `cargo clean` risk is a re-download, not data loss |
| 5 | Fix `dir_size` counting hardlinked bytes twice | **Done** — kit change, opt-in per bucket |

Net: **+23.5 GiB free** (E: 1192.8 → 1216.3 GiB), which is exactly 1.18 + 22.32.

---

## 2. The two data dirs — the corrected picture

`CLAUDE.md` already says there are two roots in a source checkout and that the
gate needs `--data-dir`. What it did not say is **what is in them**, and the
earlier session's framing of the live one — *"~50 GB of real user data"* — was
**wrong**. Measured:

### The live root — `src-tauri/target/debug/data` (49.4 GiB naive)

| Folder | Naive size | Files | What it is |
|---|---|---|---|
| `ai-cache` | 45.7 GB | 73 | HF GGUFs — gemma-4-26B 13.3 · gemma-4-12B 6.3 · Qwen3-Embedding-4B 2.3 — plus llama.cpp CUDA dlls |
| `speech-cache` | 3.66 GB | 373 | regenerable TTS output |
| `justvoice.db` | 495 KB | 1 | — |
| `voices` `personas` `lexicons` `cache` | 0 | **0 each** | reset by the user |
| `justvoice/training` | 12 KB | 2 | Alder + Wren (see §3) |

**So `cargo clean` would cost a ~23 GB re-download, not the user's work.** The
urgency previously attached to this was misplaced. It stays where it is (item 4)
— that was the user's call on the recommendation.

After the §5 reclaim the naive number is unchanged at 49.4 GiB while the disk
holds ~27 GB. See §6 for why, and why that is no longer what the app reports.

### The stale root — `<repo>/data` — DELETED 2026-08-22

1.18 GB, of which 1.18 GB was `speech-cache`. DB last written 2026-08-20;
`voices`, `personas`, `lexicons`, `generations`, `cache` all **zero files**.
Untracked and `.gitignore`d (`.gitignore:63`). This is the root that made the
2026-08-21 gate report seven false view failures.

> **Deleting it did not remove the trap — it re-armed it.** A headless run with
> no `--data-dir` resolves to the checkout root and will **create a fresh empty
> one**, which looks healthy and is still the wrong database. The flag is not
> optional:
>
> ```
> justvoice-server serve --host 127.0.0.1 --port 8741 \
>   --data-dir src-tauri/target/debug/data
> ```

### Why they diverge (unchanged, restated so it is in one place)

- Rust `default_data_root()` → `exe_dir()/data` (`src-tauri/src/lib.rs:91`), which
  in `tauri dev` is `src-tauri/target/debug/data`. Handed to the sidecar as
  `JUSTVOICE_DATA_DIR`.
- Python with no env var and no flag → `install_dir()`, which unfrozen is the
  **checkout root**.
- In a packaged build both resolve to the frozen exe's folder, so this exists
  **only in dev**.
- There is **no `dataroot.txt`** anywhere on this machine (checked `exe_dir()`
  and `%APPDATA%`), so resolution falls through to the computed default.
  `resolve_data_root()` (`lib.rs:145`) would delete a pointer holding exactly a
  former default, treating it as residue rather than a choice.

---

## 3. The near-miss — Alder and Wren were in the "junk" directory

The stale root was **not** pure cache. It held two Dataset Builder projects:

```
dsb-915458bc1889 | Alder | qwen3 | rows=33 | seed=41
dsb-3128dc8572f7 | Wren  | qwen3 | rows=33 | seed=42
```

Written 2026-08-21 03:10 — *after* that root's own database was last touched —
with full voice descriptions and 33 script rows each. **They existed nowhere
else**: the live root had no `builder/` directory at all. These are the two
voices carried in `TASKS.md` as staged built-in voices.

They were copied to the live root, verified byte-identical (SHA-256) and
verified through the app's own loader before the delete:

```
python -c "from justvoice.storage.dataset_builder import list_projects; ..."
 - dsb-915458bc1889 | Alder | qwen3 | rows= 33 | seed= 41
 - dsb-3128dc8572f7 | Wren  | qwen3 | rows= 33 | seed= 42
```

**The lesson is the boring one and it nearly cost real work:** a directory
measured as 99.9 % regenerable cache still had the only copy of something. The
size breakdown said "junk"; the file listing said otherwise. Look at the target,
not at its total.

### Dataset-builder storage shape (so nobody greps for it again)

`server/justvoice/storage/dataset_builder.py:37-72`. Pure filesystem, **no DB
rows**:

```
$DATA_DIR/justvoice/training/builder/<id>/project.json
```

discovered by `builder_root(data_dir).glob("*/project.json")`. A project is
self-contained: rows are `{emotion, text, seed, status}` — no audio paths — so
moving the directory moves the project. Copy it into another data root and the
app lists it.

---

## 4. Why the HF cache held every model twice

HuggingFace stores one copy of a file in `blobs/<sha256>` and gives it a second
name under `snapshots/<rev>/<filename>`. Normally that second name is a
**symlink**. On Windows a symlink needs Developer Mode or admin, so `hf` falls
back to a **full byte-for-byte copy**.

That fallback is the direct cost of the user's 2026-08-13 ruling rejecting
Developer Mode and `HF_HUB_DISABLE_SYMLINKS`. The ruling stands; this is the
price, now measured: **every model occupies twice its size**.

Confirmed here — five snapshot files, five blobs, 22.32 GB on each side,
`fsutil hardlink list` returning a single path per blob (i.e. genuinely two
independent files, not one file with two names).

### The fact that makes dedup safe

**An HF blob's filename IS the SHA-256 of its content.** Verified:

```
snapshot sha256 : 7272d97595f0d4c74bd7b623492b7dbdaafd8b7c72f329a8270ba4eca68f768a
blob exists     : True
```

So a snapshot copy can be matched to its blob by **proof**, never by size
heuristics.

---

## 5. The reclaim — procedure and proof

Each `snapshots/` copy was replaced by a **hardlink** to its blob. Hardlinks
need no admin rights on Windows, so this does not reopen the symlink ruling, and
HF only requires that the snapshot path resolve to the right bytes.

Order per file, so the content is never reachable by only one name:

1. `sha256(snapshot)` → must equal the blob's filename; mismatch skips the file.
2. Sizes must match.
3. `os.link(blob, snapshot + ".hltmp")` — content now has two names.
4. Delete the original snapshot copy — the blob still holds it.
5. `os.replace(tmp, snapshot)`.
6. Verify `st_nlink >= 2` and size unchanged.

The script is `hf_dedup.py` (dry-run by default, `--apply` to act). It was a
throwaway in the session scratchpad, not shipped — the procedure above is the
part worth keeping.

**Result: 22.32 GB across 5 files, zero skips.**

### Verification (three independent checks)

| Check | Result |
|---|---|
| Re-hash all 5 snapshot paths after linking | digests unchanged, `nlink=2` on every one |
| `huggingface_hub.scan_cache_dir()` | 3 repos, **no warnings**, 22.32 GB |
| Free space | 1192.8 → 1216.3 GiB (+23.5, = 1.18 + 22.32) |

**`Clear` still works.** `clear_models_cache()` does `shutil.rmtree(hf)` and
`delete_model_cache()` removes the whole `models--<repo>` directory — both names
go, so all bytes come back. No orphans. Only the *reported* number was wrong,
which is §6.

---

## 6. The defect this exposed — `dir_size` counted hardlinked bytes twice

**Kit change, FIXED 2026-08-22.**

`llm_runner/platform/disk_api.py` skipped symlinks precisely so an HF blob would
be "counted exactly once". That reasoning only holds where HF *can* symlink.
A hardlink is not a symlink — `entry.is_symlink()` is False — so after §5 both
names counted and `modelsCache` reported **44.64 GB for 22.32 GB of disk**.

Affected `GET /v1/disk/usage`, `models-cache/clear`'s `bytes` freed, and
`models-cache/delete`'s — every one overstating by 2×. JustWrite mounts the same
router, so it was wrong there too.

### The fix

`dir_size(path, exclude=None, dedup_links=False)` — when deduping, it counts each
**inode** once, keyed on `(st_dev, st_ino)` shared across the whole walk (the two
names live in different directories).

**Opt-in per bucket, deliberately.** It costs an `os.stat` per file — measured at
**65 µs/file vs 21 µs** for `DirEntry.stat()`, so ~3× the walk. Harmless for the
73-file model cache; not something to inflict on a render cache that could reach
six figures. Enabled at three call sites, all of them HF:
`disk_api.py:209`, `lifecycle.py:951`, `lifecycle.py:1023`.

### The trap inside the fix — Windows `DirEntry.stat()` has no link data

The obvious implementation keys on `entry.stat().st_ino`. **On Windows that
silently destroys the measurement.** A `DirEntry`'s stat comes from the directory
listing, which carries no link information:

```
DirEntry: ino=0  nlink=0  dev=0   |   os.stat: ino=1688849860469385  nlink=2  dev=...
```

Every file would key on `(0, 0)`, collapse into one entry, and the panel would
report a single file's size for the whole cache — a failure that reads as
plausible rather than as an error. Hence `os.stat(entry.path)`, and the
`st_ino` truthiness guard so a platform reporting no inode counts normally
instead of merging.

`tests/test_disk_api.py` gained both directions:
`test_hardlinked_blob_counted_once` and
`test_dedup_does_not_merge_distinct_files_of_equal_size` — the second exists
purely to fail if someone "simplifies" it back to `DirEntry.stat()`.

Proof on the real cache after the fix:

```
naive  : 44.64 GB
deduped: 22.32 GB     ← matches scan_cache_dir exactly
```

---

## 7. The console script was never broken (correction)

Carried for weeks, including in memory and in
`2026-08-21-blend-rework-and-consistency-audit.md` §17.5: *"the global
`justvoice-server` on `F:\Python312` is stale — it targets `justvoice.cli:app`,
which lost `serve` on 2026-08-07."*

**That is no longer true and the reinstall would have been a no-op.** As
installed:

```
F:\Python312\Lib\site-packages\justvoice-0.0.1.dist-info\entry_points.txt
[console_scripts]
justvoice-server = justvoice.serve:main
```

matching `server/pyproject.toml:71`, editable against the checkout
(`import justvoice` resolves to `E:\Dev\Web\JustVioce\server\justvoice`). It was
also observably *running* with `serve --host --port --data-dir`.

**The cause is known**: the parallel environment-migration session hit the same
wall, fixed it with `cd server && pip install -e .`, and recorded it as a trap.
So the claim was true when written and stale within a day — nobody re-checked
before repeating it. Verify an environment claim against the environment.

That session also fixed a related bite worth knowing: **a relative `--data-dir`
used to break engine loads**, because engine subprocesses run from their own
plugin folder and resolved it against the wrong cwd (Kokoro reporting "model
files not found" over files that were present). `serve.py` now `.resolve()`s the
path once, up front — which is why `CLAUDE.md`'s gate recipe, which passes a
relative path, is safe.

---

## 8. Also cleaned

A gate server from the 2026-08-21 session was still running — `justvoice-server
serve … --port 8741`, started 15:26 the previous day, holding a Kokoro engine
subprocess. Four processes. Killed by PID tree (`taskkill /PID <pid> /T /F`);
port 8741 released.

**Kill gate servers by port or PID, never by image name** — the user's app is the
same image.

---

## 9. Verified green

| Suite | Result |
|---|---|
| Kit `pytest` | **911 passed, 10 skipped** (87 s) |
| Kit `ruff` (changed files) | clean |
| JV server `pytest` | **726 passed** (318 s) |
| JV `ruff check .` | clean |
| New disk tests | both **PASSED**, not skipped — hardlinks need no privilege on Windows |
| `gh workflow list --all` | all three still `disabled_manually` |

**Not run, because nothing they cover changed:** the renderer gate and the unit
suites — this session touched Python and docs only. The 2026-08-21 sweep's
visual surfaces remain unverified (§11).

---

## 10. Facts worth never re-deriving

- The live data root is **~46 GB of re-downloadable model cache**, not user work.
  The user's actual content in it is a 495 KB DB and two 6 KB project files.
- **An HF blob's filename is the SHA-256 of its content** — match by proof.
- **HF copies instead of symlinking on Windows** without Developer Mode; every
  model costs 2× disk. Hardlinks need no privilege and fix it after the fact.
- **`DirEntry.stat()` on Windows returns `st_ino=0`, `st_nlink=0`, `st_dev=0`.**
  Any inode logic must use `os.stat()`.
- **Folder-size tools double-count hardlinks.** After §5 the data dir measures
  49.4 GiB and occupies ~27 GB. `b7a54ef` hit the same illusion from the other
  direction ("du was counting the same bytes five times").
- **Deleting `<repo>/data` re-arms the trap rather than removing it** — a bare
  headless run recreates an empty one.
- **The global `justvoice-server` is fine** (§7).
- Dataset Builder projects are **filesystem-only sidecars** (§3) — they do not
  appear in the database, so a DB-shaped backup or diff will not see them.

---

## 11. Still open

- **HF still stores every model twice on Windows.** Only the *counting* was
  fixed; the duplication is unchanged, and every new download re-creates it. The
  fix would be to hardlink at download time when a symlink is unavailable —
  recorded in the kit tracker, **not built, needs a go**.
- **Nothing visual has been verified** from the 2026-08-21 sweep. Unchanged by
  this session and still true: sixteen grids, nine sliders, two tab strips and a
  load bar changed shape and none has been seen rendered.
- The ~49 GB data root still lives inside `src-tauri/target/debug/`, by the
  user's decision (item 4). `cargo clean` costs a re-download.
