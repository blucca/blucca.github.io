"""Aggregate run records into per-arm results with hierarchical bootstrap CIs.

Headline metric: cost per solved task = total cost of an arm's runs / its solved runs.

Bootstrap: resample tasks with replacement (shared across arms, so comparisons are
paired by task), then resample each arm's runs within each sampled task. Differences
are reported relative to `baseline`; the `noop - baseline` interval is the noise floor.
"""

from __future__ import annotations

import json
import math
import random
from collections import defaultdict
from pathlib import Path

from tokentrial.pricing import TOKEN_TYPES
from tokentrial.runner import FINAL_STATUSES

BASELINE, CONTROL, HOOK_CONTROL = "baseline", "noop", "noop-hook"

# Each tool's matched control: an arm that reproduces the tool's known side effects on
# Claude Code but not the tool itself, so tool vs control isolates the tool.
MATCHED_CONTROL = {
    "caveman": HOOK_CONTROL,  # SessionStart hook: Claude Code skips its title call
    "caveman-v4.1.0": HOOK_CONTROL,
    "headroom": "headroom-passthrough",  # local proxy: title call skipped; MCP tools added
    "rtk": BASELINE,  # PreToolUse hook only: no known side effect
    "rtk-v1.2.0": BASELINE,
}


def load_records(exp_dir: Path) -> list[dict]:
    latest: dict[str, dict] = {}
    for line in (exp_dir / "records.jsonl").read_text().splitlines():
        if line.strip():
            rec = json.loads(line)
            latest[rec["run_id"]] = rec
    return [r for r in latest.values() if r["status"] in FINAL_STATUSES]


def _total_cost(r: dict) -> float:
    return r["cost_usd"]["total"]


def _main_cost(r: dict) -> float:
    """Benchmarked model only, excluding Claude Code's background calls on other models."""
    return r.get("cost_main_usd", r["cost_usd"]["total"])


def _cost_per_solved(runs: list[dict], cost=_total_cost) -> float:
    solved = sum(r["solved"] for r in runs)
    return sum(cost(r) for r in runs) / solved if solved else math.inf


def _pct(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return math.nan
    k = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def _ci(vals: list[float]) -> tuple[float, float]:
    finite = sorted(v for v in vals if math.isfinite(v))
    return _pct(finite, 0.025), _pct(finite, 0.975)


def bootstrap(
    by_arm_task: dict[str, dict[str, list[dict]]],
    n: int = 10_000,
    seed: int = 0,
    cost=_total_cost,
) -> dict[str, list[float]]:
    """Cost-per-solved samples per arm, from a task-then-run hierarchical bootstrap."""
    rng = random.Random(seed)
    arms = sorted(by_arm_task)
    tasks = sorted({t for a in arms for t in by_arm_task[a]})
    samples: dict[str, list[float]] = {a: [] for a in arms}
    for _ in range(n):
        picked = [rng.choice(tasks) for _ in tasks]
        for a in arms:
            runs: list[dict] = []
            for t in picked:
                pool = by_arm_task[a].get(t, [])
                runs.extend(rng.choice(pool) for _ in pool)
            samples[a].append(_cost_per_solved(runs, cost))
    return samples


def summarize(records: list[dict], n_boot: int = 10_000, seed: int = 0) -> dict:
    by_arm_task: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in records:
        by_arm_task[r["arm"]][r["task"]].append(r)
    samples = bootstrap(by_arm_task, n_boot, seed)
    main_samples = bootstrap(by_arm_task, n_boot, seed, cost=_main_cost)

    arms: dict[str, dict] = {}
    for arm, tasks in sorted(by_arm_task.items()):
        runs = [r for rs in tasks.values() for r in rs]
        n = len(runs)
        solved = sum(r["solved"] for r in runs)
        cps = _cost_per_solved(runs)
        lo, hi = _ci(samples[arm])

        def mean(key, runs=runs, n=n):
            return sum(key(r) for r in runs) / n

        arms[arm] = {
            "runs": n,
            "solved": solved,
            "solve_rate": solved / n,
            "solved_by_task": {t: sum(r["solved"] for r in rs) for t, rs in sorted(tasks.items())},
            "cost_per_solved": cps,
            "cost_per_solved_ci95": [lo, hi],
            "mean_cost_per_run": mean(lambda r: r["cost_usd"]["total"]),
            "mean_cost_by_type": {t: mean(lambda r, t=t: r["cost_usd"][t]) for t in TOKEN_TYPES},
            "mean_tokens_by_type": {t: mean(lambda r, t=t: r["usage"][t]) for t in TOKEN_TYPES},
            "mean_background_cost": mean(lambda r: _total_cost(r) - _main_cost(r)),
            "runs_with_background_calls": sum(bool(r.get("usage_aux")) for r in runs),
            "main_model_cost_per_solved": _cost_per_solved(runs, _main_cost),
            "main_model_cost_per_solved_ci95": list(_ci(main_samples[arm])),
            "mean_turns": mean(lambda r: r.get("num_turns") or 0),
            "mean_duration_s": mean(lambda r: r.get("duration_s") or 0),
        }

    def _vs(arm_samples, base_samples, point_arm, point_base):
        rel = [
            a / b - 1
            for a, b in zip(arm_samples, base_samples, strict=True)
            if math.isfinite(a) and math.isfinite(b)
        ]
        return {"point": point_arm / point_base - 1, "ci95": list(_ci(rel))}

    noise = None
    if BASELINE in samples:
        b = arms[BASELINE]
        for arm, info in arms.items():
            if arm == BASELINE:
                continue
            info["vs_baseline"] = _vs(
                samples[arm], samples[BASELINE], info["cost_per_solved"], b["cost_per_solved"]
            )
            info["main_model_vs_baseline"] = _vs(
                main_samples[arm],
                main_samples[BASELINE],
                info["main_model_cost_per_solved"],
                b["main_model_cost_per_solved"],
            )
        if CONTROL in arms:
            noise = arms[CONTROL]["vs_baseline"]

    # Tools that install a SessionStart hook also trigger Claude Code's side effect of
    # skipping its session-title call; comparing with the noop-hook control removes it.
    if HOOK_CONTROL in samples:
        h = arms[HOOK_CONTROL]
        for arm, info in arms.items():
            if arm in (BASELINE, CONTROL, HOOK_CONTROL):
                continue
            info["vs_noop_hook"] = _vs(
                samples[arm], samples[HOOK_CONTROL], info["cost_per_solved"], h["cost_per_solved"]
            )

    for arm, info in arms.items():
        control = MATCHED_CONTROL.get(arm)
        if control and control in samples:
            info["matched_control"] = control
            info["vs_matched_control"] = (
                info["vs_baseline"]
                if control == BASELINE
                else _vs(
                    samples[arm],
                    samples[control],
                    info["cost_per_solved"],
                    arms[control]["cost_per_solved"],
                )
            )

    controls = {BASELINE, CONTROL, HOOK_CONTROL, *MATCHED_CONTROL.values(), "noop-baseurl"}
    for arm, info in arms.items():
        vs = info.get("vs_baseline")
        if arm in controls or not vs or not noise:
            continue
        lo, hi = vs["ci95"]
        nlo, nhi = noise["ci95"]
        if hi < 0 and vs["point"] < nlo:
            verdict = "cheaper than baseline, beyond the noise floor"
        elif lo > 0 and vs["point"] > nhi:
            verdict = "more expensive than baseline, beyond the noise floor"
        else:
            verdict = "inconclusive (CI includes no change or overlaps the noise floor)"
        info["verdict"] = verdict

    return {
        "n_records": len(records),
        "bootstrap": {"resamples": n_boot, "seed": seed, "method": "tasks, then runs within task"},
        "noise_floor_noop_vs_baseline": noise,
        "arms": arms,
    }


def _usd(x: float) -> str:
    return "∞" if not math.isfinite(x) else f"${x:.4f}"


def _rel(x: float) -> str:
    return "n/a" if not math.isfinite(x) else f"{x * 100:+.0f}%"


def to_markdown(summary: dict, manifest: dict) -> str:
    arms = summary["arms"]
    order = [
        a
        for a in (
            "baseline",
            "noop",
            "noop-hook",
            "noop-baseurl",
            "headroom-passthrough",
            "rtk",
            "rtk-v1.2.0",
            "caveman",
            "caveman-v4.1.0",
            "headroom",
        )
        if a in arms
    ]
    order += [a for a in arms if a not in order]
    out = [
        f"# TokenTrial results: {manifest.get('name') or 'experiment'}",
        "",
        f"Model `{manifest['model']}`, mode `{manifest['mode']}` (API-equivalent cost), "
        f"{len(manifest['task_ids'])} tasks × {len(manifest['arms'])} arms × "
        f"{manifest['repeats']} repeats = {summary['n_records']} runs. "
        f"95% CIs from a {summary['bootstrap']['resamples']:,}-resample hierarchical bootstrap "
        "(tasks, then runs).",
        "",
        "| Arm | Solved | Cost per solved task (95% CI) | vs baseline (95% CI) "
        "| Mean cost/run | Verdict |",
        "|---|---|---|---|---|---|",
    ]
    for a in order:
        i = arms[a]
        lo, hi = i["cost_per_solved_ci95"]
        vs = i.get("vs_baseline")
        vs_s = (
            f"{_rel(vs['point'])} ({_rel(vs['ci95'][0])} to {_rel(vs['ci95'][1])})" if vs else "—"
        )
        verdict = i.get("verdict") or {
            CONTROL: "noise floor",
            HOOK_CONTROL: "control: SessionStart-hook side effect",
            "noop-baseurl": "control: ANTHROPIC_BASE_URL set",
            "headroom-passthrough": "control: headroom proxy, optimization off",
        }.get(a, "reference")
        out.append(
            f"| `{a}` | {i['solved']}/{i['runs']} | {_usd(i['cost_per_solved'])} "
            f"({_usd(lo)} to {_usd(hi)}) | {vs_s} | {_usd(i['mean_cost_per_run'])} | {verdict} |"
        )
    out += [
        "",
        "## Benchmarked model only (excluding Claude Code's background calls)",
        "",
        "| Arm | Runs with background call | Cost per solved task (95% CI) "
        "| vs baseline (95% CI) |",
        "|---|---|---|---|",
    ]
    for a in order:
        i = arms[a]
        lo, hi = i["main_model_cost_per_solved_ci95"]
        vs = i.get("main_model_vs_baseline")
        vs_s = (
            f"{_rel(vs['point'])} ({_rel(vs['ci95'][0])} to {_rel(vs['ci95'][1])})" if vs else "—"
        )
        out.append(
            f"| `{a}` | {i['runs_with_background_calls']}/{i['runs']} "
            f"| {_usd(i['main_model_cost_per_solved'])} ({_usd(lo)} to {_usd(hi)}) | {vs_s} |"
        )
    if any("vs_noop_hook" in arms[a] for a in order):
        out += [
            "",
            "## Tools vs the `noop-hook` control",
            "",
            "Same SessionStart-hook side effect on both sides, so this isolates the tool itself.",
            "",
            "| Arm | Cost per solved task vs `noop-hook` (95% CI) |",
            "|---|---|",
        ]
        for a in order:
            vs = arms[a].get("vs_noop_hook")
            if vs:
                lo, hi = vs["ci95"]
                out.append(f"| `{a}` | {_rel(vs['point'])} ({_rel(lo)} to {_rel(hi)}) |")
    if any("vs_matched_control" in arms[a] for a in order):
        out += [
            "",
            "## Tools vs their matched control",
            "",
            "Each control reproduces the tool's known side effects on Claude Code (a "
            "SessionStart hook, or routing through a local proxy) without the tool itself.",
            "",
            "| Arm | Matched control | Cost per solved task vs control (95% CI) |",
            "|---|---|---|",
        ]
        for a in order:
            vs = arms[a].get("vs_matched_control")
            if vs:
                lo, hi = vs["ci95"]
                out.append(
                    f"| `{a}` | `{arms[a]['matched_control']}` "
                    f"| {_rel(vs['point'])} ({_rel(lo)} to {_rel(hi)}) |"
                )
    out += [
        "",
        "## Mean tokens per run, by type",
        "",
        "Benchmarked model only.",
        "",
        "| Arm | Fresh input | Cache write 5m | Cache write 1h | Cache read | Output | Turns |",
        "|---|---|---|---|---|---|---|",
    ]
    for a in order:
        t = arms[a]["mean_tokens_by_type"]
        out.append(
            f"| `{a}` | {t['input']:,.0f} | {t['cache_write_5m']:,.0f} "
            f"| {t['cache_write_1h']:,.0f} | {t['cache_read']:,.0f} | {t['output']:,.0f} "
            f"| {arms[a]['mean_turns']:.1f} |"
        )
    out += [
        "",
        "## Mean cost per run, by type (USD, API-equivalent)",
        "",
        "Fresh input includes the background model's calls; the last column shows that part.",
        "",
        "| Arm | Fresh input | Cache write | Cache read | Output | of which background model |",
        "|---|---|---|---|---|---|",
    ]
    for a in order:
        c = arms[a]["mean_cost_by_type"]
        cw = c["cache_write_5m"] + c["cache_write_1h"]
        out.append(
            f"| `{a}` | {c['input']:.5f} | {cw:.5f} | {c['cache_read']:.5f} | {c['output']:.5f} "
            f"| {arms[a]['mean_background_cost']:.5f} |"
        )
    tasks = sorted({t for a in order for t in arms[a]["solved_by_task"]})
    out += [
        "",
        "## Solved runs by task",
        "",
        "| Task | " + " | ".join(f"`{a}`" for a in order) + " |",
    ]
    out.append("|---|" + "---|" * len(order))
    for t in tasks:
        cells = [f"{arms[a]['solved_by_task'].get(t, 0)}/{manifest['repeats']}" for a in order]
        out.append(f"| `{t}` | " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"


def export_raw(exp_dir: Path, dest: Path) -> list[Path]:
    """Copy manifest, records and raw logs for publishing, with the home path replaced by ~.

    Raw stream logs can contain absolute paths under the user's home directory (e.g.
    Claude Code's saved tool outputs, plugin paths) and the username itself (file owners
    in `ls -l` output); both are scrubbed.
    """
    import getpass
    import io
    import re
    import tarfile

    home = str(Path.home())
    # Not preceded by a word character, except as the start of a JSON escape such as the
    # "\\n" before a `ps` line ("\\nalice  123 ..."), where `\\b` finds no boundary.
    user = re.compile(rf"(?:(?<=\\[ntr])|(?<!\w)){re.escape(getpass.getuser())}(?!\w)")

    def scrub(text: str) -> str:
        # Home path first (-> ~), then the bare username (e.g. file owners in `ls -l`).
        return user.sub("user", text.replace(home, "~"))

    dest.mkdir(parents=True, exist_ok=True)
    written = []
    for name in ("manifest.json", "records.jsonl"):
        out = dest / name
        out.write_text(scrub((exp_dir / name).read_text()))
        written.append(out)
    archive = dest / "logs.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for log in sorted((exp_dir / "logs").iterdir()):
            data = scrub(log.read_text()).encode()
            info = tarfile.TarInfo(f"logs/{log.name}")
            info.size = len(data)
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))
    written.append(archive)
    return written
