#!/usr/bin/env python3
"""Replay the published November 2026 SCS Mittelmann CPU/GPU records.

Usage: python replay.py [local-results.jsonl]
The fixed 37-problem scope intentionally rejects another campaign. Extend it
only after choosing that campaign's problem set and verification contract.
This scores stored residuals; it does not solve LPs or recompute their KKT data.
"""

import json
import math
import statistics
import sys
import urllib.request

SOURCE = (
    "https://raw.githubusercontent.com/bodono/solver_benchmarks_results/"
    "3186dfa179c07e7d032bed9ff2cdf930c6f29f3f/"
    "scs332_2026-11/merged/mittelmann/results.jsonl"
)
FIELDS = ("primal_res_rel", "dual_res_rel", "duality_gap_rel")
SOLVERS = {"cpu": "scs_cpu_1e-4", "gpu": "scs_cudss_1e-4"}
LIMIT, GRACE, PENALTY, SHIFT, FLOOR, TOL = 1800, 60, 5400, 10, .01, 1e-3


def finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def score(row):
    residuals = [(row.get("kkt") or {}).get(field) for field in FIELDS]
    maximum = max(map(abs, residuals)) if all(map(finite, residuals)) else None
    time = row.get("run_time_seconds")
    passed = (maximum is not None and maximum < TOL and finite(time)
              and 0 <= time <= LIMIT + GRACE)
    return {
        "verified": passed,
        "seconds": time if finite(time) else None,
        "max_relative_kkt": maximum,
        "reported_status": row.get("status"),
        "scored_seconds": max(time, FLOOR) if passed else PENALTY,
    }


def shifted_gm(times):
    return math.exp(statistics.fmean(math.log(t + SHIFT) for t in times)) - SHIFT


def checks():
    good = {"kkt": dict.fromkeys(FIELDS, 1e-5), "run_time_seconds": 2,
            "status": "time_limit"}
    assert score(good)["verified"]  # Acceptance follows residuals + actual time.
    bad = {**good, "kkt": {**good["kkt"], FIELDS[0]: .01}, "status": "optimal"}
    assert score(bad)["scored_seconds"] == PENALTY
    assert not score({**good, "run_time_seconds": 1861})["verified"]
    assert not score({**good, "kkt": {FIELDS[0]: None}})["verified"]
    assert not score({**good, "kkt": dict.fromkeys(FIELDS, float("nan"))})["verified"]
    assert math.isclose(shifted_gm([2, 2]), 2)
    assert math.isclose(shifted_gm([2, PENALTY]), math.sqrt(12 * 5410) - 10)


def replay(rows):
    arms = {arm: {} for arm in SOLVERS}
    for row in rows:
        for arm, solver in SOLVERS.items():
            if row["solver_id"] == solver:
                key = row["dataset"], row["problem"]
                assert key not in arms[arm], ("duplicate", arm, key)
                arms[arm][key] = score(row)
    assert len(arms["cpu"]) == len(arms["gpu"]) == 37
    assert arms["cpu"].keys() == arms["gpu"].keys()
    keys = sorted(arms["cpu"])
    groups = {name: [] for name in ("both", "cpu_only", "gpu_only", "neither")}
    pairs = []
    for key in keys:
        cpu, gpu = arms["cpu"][key], arms["gpu"][key]
        group = ("both" if cpu["verified"] and gpu["verified"] else
                 "cpu_only" if cpu["verified"] else
                 "gpu_only" if gpu["verified"] else "neither")
        groups[group].append(key[1])
        pairs.append({"dataset": key[0], "problem": key[1], "cpu": cpu, "gpu": gpu})
    common = [pair for pair in pairs if pair["cpu"]["verified"] and pair["gpu"]["verified"]]
    result = {
        "source": SOURCE,
        "scope": "Published residuals and solver-call wall time, 37 LPs; no new LP solves.",
        "contract": {"requested_tol": 1e-4, "kkt_threshold": TOL,
                     "limit_seconds": LIMIT, "grace_seconds": GRACE,
                     "failure_seconds": PENALTY, "shift_seconds": SHIFT,
                     "time_floor_seconds": FLOOR},
        "all_tasks": {
            arm: {"verified": sum(r["verified"] for r in records.values()),
                  "shifted_gm_seconds": shifted_gm([r["scored_seconds"] for r in records.values()])}
            for arm, records in arms.items()
        },
        "groups": groups,
        "common_success": {
            "count": len(common),
            "geometric_mean_cpu_over_gpu": math.exp(statistics.fmean(
                math.log(p["cpu"]["scored_seconds"] / p["gpu"]["scored_seconds"])
                for p in common)),
            "shifted_gm_seconds": {
                arm: shifted_gm([p[arm]["scored_seconds"] for p in common]) for arm in SOLVERS
            },
            "gpu_slower": [p["problem"] for p in common
                           if p["gpu"]["seconds"] > p["cpu"]["seconds"]],
        },
        "per_problem": pairs,
    }
    assert result["all_tasks"]["cpu"]["verified"] == 24
    assert result["all_tasks"]["gpu"]["verified"] == 29
    assert round(result["all_tasks"]["cpu"]["shifted_gm_seconds"]) == 361
    assert round(result["all_tasks"]["gpu"]["shifted_gm_seconds"]) == 152
    return result


if __name__ == "__main__":
    checks()
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as stream:
            text = stream.read()
    else:
        with urllib.request.urlopen(SOURCE, timeout=60) as response:
            text = response.read().decode("utf-8")
    print(json.dumps(replay([json.loads(line) for line in text.splitlines() if line.strip()]),
                     indent=2, allow_nan=False))
