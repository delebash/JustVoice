# SPDX-License-Identifier: MIT
"""Check the engine environments against what the manifests declare, and the
manifests against what upstream currently ships.

A hand-run dev command. Nothing schedules it and no CI depends on it:

    npm run check:engines              # drift + upstream
    npm run check:engines -- --drift   # only what is installed here
    npm run check:engines -- --upstream
    npm run check:engines -- --test chatterbox

The three questions it answers:

**drift** — does each engine's venv actually contain what its manifest asks
for? This is the check that was missing when `peft` sat in two manifests and
in no environment: the engines reported installed, the UI agreed, and LoRA
training would have refused on a machine that looked ready. Per-engine venvs
make the question exact — there is one environment per manifest, so a package
is either in it or it is not.

**upstream** — has anything we pin moved? Git refs against GitHub's current
head, pip pins against PyPI's latest release, model revisions against the HF
repo's current commit. Moved is not wrong: pins exist to be deliberate. This
prints what changed so the decision to bump is made by a person looking at a
diff, not discovered when an install breaks.

**--test <engine>** — build a throwaway venv from the manifest's declared
steps and import the engine's adapter inside it, which is what catches a
declared package set that does not actually satisfy the code. It stops
there and leaves the venv in place with the command to render a line
yourself; it does NOT render one for you. Slow (a full torch download unless
the uv cache is warm), which is why it is opt-in and one engine at a time.

Network failures degrade to "unreachable" and never abort the run — a check
that cannot run offline is a check nobody runs.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

# Windows consoles still default to cp1252, which cannot encode an em dash —
# printing one raises UnicodeEncodeError and kills the run several lines in.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, OSError):  # pragma: no cover — non-standard streams
    pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from justvoice.engines.manager import (  # noqa: E402
    ENGINE_PYTHON_VERSION,
    _check_uv_available,
    _detect_torch_index_url,
    _uv_env,
    _venv_python,
    discover_engines,
)
from justvoice.paths import default_data_dir  # noqa: E402

UA = {"User-Agent": "justvoice-check-engines/1.0"}
OK, WARN, BAD = "ok", "MOVED", "MISSING"


def _get_json(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
            return json.loads(r.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return None, f"unreachable ({type(e).__name__})"


def _req_name(spec: str) -> str:
    """`peft>=0.14` → `peft`; `x @ git+...` → `x`.

    Normalised per PEP 503: a requirement may say `spacy-pkuseg` while the
    installed distribution calls itself `spacy_pkuseg`, and comparing the raw
    strings reports a package as MISSING when it is sitting right there.
    """
    spec = str(spec).split("@")[0]
    name = re.split(r"[<>=!~\[; ]", spec, 1)[0].strip()
    return re.sub(r"[-_.]+", "-", name).lower()


def _spec_bound(spec: str) -> tuple[str, str] | None:
    """(`==`, `2.13.0`) for a pinned spec, else None."""
    m = re.search(r"(==|>=|<=|~=)\s*([0-9][0-9A-Za-z.\-+]*)", str(spec))
    return (m.group(1), m.group(2)) if m else None


# ─── drift ────────────────────────────────────────────────────────────


def installed_versions(python_exe: Path) -> dict[str, str] | None:
    """name → version for every distribution in that venv, asked of the venv's
    own interpreter (never this one — they are different environments)."""
    code = (
        "import json,importlib.metadata as m;"
        "import re;"
        "n=lambda s: re.sub(r'[-_.]+','-',s).lower();"
        "print(json.dumps({n(d.metadata['Name']): d.version "
        "for d in m.distributions() if d.metadata['Name']}))"
    )
    try:
        p = subprocess.run([str(python_exe), "-c", code],
                           capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    try:
        return json.loads(p.stdout.strip())
    except ValueError:
        return None


def check_drift() -> int:
    print("── drift: manifest vs the environment on this machine ──\n")
    problems = 0
    for eid, m in sorted(discover_engines().items()):
        py = _venv_python(m.venv_dir)
        if not py.is_file():
            print(f"{eid:12s}  no venv — not installed")
            continue
        have = installed_versions(py)
        if have is None:
            print(f"{eid:12s}  VENV BROKEN — its interpreter did not run "
                  f"({py}). Reinstall the engine.")
            problems += 1
            continue

        wanted: list[str] = []
        for step in m.install_steps:
            if step.get("kind") in ("pip", "pip-no-deps", "torch", "pip-find-links"):
                wanted += [str(p) for p in (step.get("packages") or [])]

        missing, violated = [], []
        for spec in wanted:
            name = _req_name(spec).lower()
            if name not in have:
                missing.append(spec)
                continue
            bound = _spec_bound(spec)
            if bound and bound[0] == "==":
                # torch reports `2.13.0+cu126`; the local part is ours, not a
                # different release.
                actual = have[name].split("+")[0]
                if actual != bound[1]:
                    violated.append(f"{name}: want {bound[1]}, have {have[name]}")
        state = "ok" if not (missing or violated) else "PROBLEM"
        stale = "" if m.is_installed else "  [stamp says (re)Install]"
        print(f"{eid:12s}  {len(wanted):2d} declared, {len(have):3d} installed  "
              f"{state}{stale}")
        for spec in missing:
            print(f"               {BAD}: {spec}")
        for v in violated:
            print(f"               {WARN}: {v}")
        problems += len(missing) + len(violated)
    print(f"\n{problems} problem(s).\n")
    return problems


# ─── upstream ─────────────────────────────────────────────────────────


def check_upstream() -> int:
    print("── upstream: has anything we pin moved? ──\n")
    moved = 0
    seen_pypi: dict[str, str] = {}

    for eid, m in sorted(discover_engines().items()):
        print(f"{eid}")
        for step in m.install_steps:
            kind = step.get("kind")
            if kind == "pip-git":
                url = str(step.get("url") or "")
                ref = str(step.get("ref") or "")
                slug = re.sub(r"^https://github\.com/|\.git$", "", url)
                body, err = _get_json(f"https://api.github.com/repos/{slug}/commits?per_page=1")
                if err:
                    print(f"   git {slug:45s} pinned {ref[:12]}  ({err})")
                    continue
                head = (body[0].get("sha") if body else "") or ""
                same = head.startswith(ref) or ref.startswith(head[:len(ref)])
                print(f"   git {slug:45s} pinned {ref[:12]}  head {head[:12]}  "
                      f"{OK if same else WARN}")
                moved += 0 if same else 1
            elif kind in ("pip", "torch"):
                for spec in step.get("packages") or []:
                    bound = _spec_bound(str(spec))
                    if not bound or bound[0] != "==":
                        continue
                    name = _req_name(str(spec))
                    latest = seen_pypi.get(name.lower())
                    if latest is None:
                        body, err = _get_json(f"https://pypi.org/pypi/{name}/json")
                        latest = (body or {}).get("info", {}).get("version", "") if not err else f"({err})"
                        seen_pypi[name.lower()] = latest
                    same = latest == bound[1]
                    print(f"   pip {name:45s} pinned {bound[1]:12s}  "
                          f"pypi {latest:12s}  {OK if same else WARN}")
                    moved += 0 if same else 1

        for variant in getattr(m.module, "VARIANTS", []) or []:
            for src in variant.get("sources") or []:
                repo = src.get("hf_repo")
                if not repo:
                    continue
                pinned = str(src.get("revision") or "")
                body, err = _get_json(f"https://huggingface.co/api/models/{repo}")
                if err:
                    print(f"   hf  {repo:45s} pinned {pinned[:12]}  ({err})")
                    continue
                sha = str(body.get("sha") or "")
                same = sha == pinned
                print(f"   hf  {repo:45s} pinned {pinned[:12]}  head {sha[:12]}  "
                      f"{OK if same else WARN}")
                moved += 0 if same else 1
    print(f"\n{moved} pin(s) behind upstream. Behind is not wrong — bump "
          f"deliberately, in a PR.\n")
    return 0


# ─── --test <engine> ──────────────────────────────────────────────────


def test_engine(engine_id: str) -> int:
    """Build a throwaway venv from the manifest and render one line in it."""
    m = discover_engines().get(engine_id)
    if m is None:
        print(f"unknown engine: {engine_id}")
        return 2
    if not m.supports_current_os():
        print(f"{engine_id} does not support this OS ({m.supported_oses})")
        return 2

    uv = _check_uv_available()
    env = _uv_env()
    index_url, label = _detect_torch_index_url()
    tmp = Path(tempfile.mkdtemp(prefix=f"jv-check-{engine_id}-"))
    venv = tmp / ".venv"
    print(f"scratch venv: {venv}  (python {ENGINE_PYTHON_VERSION}, torch index {label})")

    def run(args: list[str]) -> None:
        r = subprocess.run(args, env=env, text=True)
        if r.returncode != 0:
            raise SystemExit(f"FAILED: {' '.join(args[:6])} …")

    run([uv, "venv", str(venv), "--python", ENGINE_PYTHON_VERSION])
    py = _venv_python(venv)
    run([uv, "pip", "install", "--python", str(py),
         str(Path(__file__).resolve().parents[1] / "justvoice_plugin")])

    for step in m.install_steps:
        kind = step.get("kind")
        base = [uv, "pip", "install", "--python", str(py)]
        if kind == "pip":
            run(base + [str(p) for p in step.get("packages") or []])
        elif kind == "pip-no-deps":
            run(base + ["--no-deps", *[str(p) for p in step.get("packages") or []]])
        elif kind == "torch":
            args = base + (["--index-url", index_url] if index_url else [])
            version = step.get("version")
            pkgs = [f"{p}=={version}" if version and "=" not in str(p) else str(p)
                    for p in (step.get("packages") or ["torch", "torchaudio"])]
            run(args + pkgs)
        elif kind == "pip-git":
            spec = f"git+{step['url']}" + (f"@{step['ref']}" if step.get("ref") else "")
            run(base + (["--no-deps"] if step.get("no_deps") else []) + [spec])
        elif kind == "pip-find-links":
            run(base + ["--find-links", step["url"],
                        *[str(p) for p in step.get("packages") or []]])
        # model-* steps are skipped: the render below reads the app's own
        # caches rather than downloading the weights a second time.

    engine_py = m.engine_dir / "engine.py"
    data_dir = default_data_dir()
    probe = tmp / "probe.py"
    probe.write_text(
        "import json, sys, wave\n"
        "print('probe: importing the adapter', flush=True)\n"
        f"sys.path.insert(0, {str(m.engine_dir)!r})\n"
        "import engine  # noqa: F401\n"
        "print('probe: adapter imports OK', flush=True)\n",
        encoding="utf-8",
    )
    print(f"\nengine source: {engine_py}\ndata dir: {data_dir}")
    r = subprocess.run([str(py), str(probe)], text=True)
    if r.returncode != 0:
        print("IMPORT FAILED — the declared package set does not satisfy the adapter")
        return 1
    print(
        f"\nvenv built and the adapter imports. It is NOT torn down: render a "
        f"line yourself with\n  {py} {engine_py} serve --port 0\n"
        f"then delete {tmp} when you are done."
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--drift", action="store_true")
    ap.add_argument("--upstream", action="store_true")
    ap.add_argument("--test", metavar="ENGINE")
    a = ap.parse_args()

    if a.test:
        return test_engine(a.test)
    both = not (a.drift or a.upstream)
    rc = 0
    if a.drift or both:
        rc |= min(check_drift(), 1)
    if a.upstream or both:
        check_upstream()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
