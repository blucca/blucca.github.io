"""Two complete six-snapshot networks; research callbacks, not a PyPSA patch.

The actual-cap bound is valid for this one-bus, non-exporting reproduction only.
Extend this study only after agreeing a real network/rolling-horizon contract.
"""
import argparse
import importlib.metadata as metadata
import json
import math
import platform
import resource
import time
from pathlib import Path

import pypsa

SOURCE_SHA = "7dee89a06b945d3c65acbce0b587110672a695b3"
N, HORIZON, OVERLAP, LOAD = 6, 3, 1, 0.5
COSTS = [10, 9, 8, 7, 6, 5]
# target = e_sum_min; both networks retain the original topology and costs.
CASES = {"original": (1.0, 1.5), "exact_cap_E3": (0.5, 3.0)}
EXPECTED = {
    "original": {
        "full_horizon": True, "stock_overlap0": True, "stock_overlap1": False,
        "prefix_end_bound": True, "prefix_cutoff_bound": False,
        "prefix_actual_cap": True,
    },
    "exact_cap_E3": {
        "full_horizon": True, "stock_overlap0": True,
        "prefix_end_bound": False, "prefix_cutoff_bound": True,
    },
}


def network(p_nom, energy):
    n = pypsa.Network()
    n.set_snapshots(range(N))
    n.add("Bus", "bus")
    n.add("Load", "load", bus="bus", p_set=LOAD)
    n.add("Generator", "backup", bus="bus", p_nom=10, marginal_cost=1)
    n.add("Generator", "gen", bus="bus", p_nom=p_nom,
          marginal_cost=COSTS, e_sum_min=energy)
    return n


def finite_or_null(value):
    x = float(value)
    return x if math.isfinite(x) else None


def run(case, mode):
    p_nom, energy = CASES[case]
    n = network(p_nom, energy)
    trace = []

    def callback(n, sns):
        start, end = int(sns[0]), int(sns[-1]) + 1
        # For these six integer snapshots, the final window keeps its entire tail.
        actual_overlap = 0 if mode == "stock_overlap0" else OVERLAP
        cutoff = min(start + HORIZON - actual_overlap, N)
        if end == N:
            cutoff = N
        kept = [int(s) for s in sns if s < cutoff]
        used = n.c.generators.dynamic.p.reindex(
            index=range(start), columns=["gen"]
        ).fillna(0)["gen"].sum()
        stock_target = float(n.c.generators.static.loc["gen", "e_sum_min"])
        item = {"start": start, "end": end, "kept": kept,
                "committed_energy": float(used), "stock_target": stock_target}
        if mode.startswith("prefix_"):
            rest_start = end if mode == "prefix_end_bound" else cutoff
            upper = min(p_nom, LOAD) if mode == "prefix_actual_cap" else p_nom
            target = energy - float(used) - (N - rest_start) * upper
            key = "Generator-e_sum_min"
            if key in n.model.constraints:
                n.model.remove_constraints(key)
            lhs = n.model["Generator-p"].sel(name="gen", snapshot=kept).sum()
            n.model.add_constraints(lhs >= target, name="study-retained-energy-min")
            item.update(target=target, future_start=rest_start, future_cap=upper)
        trace.append(item)

    began = time.perf_counter()
    result = {"case": case, "mode": mode, "p_nom": p_nom,
              "e_sum_min": energy, "trace": trace}
    options = dict(solver_name="highs", threads=1, log_to_console=False,
                   extra_functionality=callback)
    try:
        if mode == "full_horizon":
            status, condition = n.optimize(**options)
            if status != "ok":
                raise RuntimeError(f"full solve: {status}/{condition}")
        else:
            overlap = 0 if mode == "stock_overlap0" else OVERLAP
            n.optimize.optimize_with_rolling_horizon(
                horizon=HORIZON, overlap=overlap, **options)
        solved = True
        result["status"] = "complete_feasible"
    except RuntimeError as e:
        # Expected scientific failures must be native infeasibility, not API/setup errors.
        if "infeasible" not in str(e).lower():
            raise
        solved = False
        result.update(status="native_infeasible", failure=str(e))
    result["elapsed_seconds"] = time.perf_counter() - began
    assert solved == EXPECTED[case][mode], (case, mode, result)
    assert float(n.c.generators.static.loc["gen", "e_sum_min"]) == energy
    raw = n.c.generators.dynamic.p.reindex(index=range(N), columns=["gen", "backup"])
    result["stored_dispatch"] = {
        name: [finite_or_null(x) for x in raw[name]] for name in ["gen", "backup"]}
    result["original_limit_restored"] = True
    if solved:
        g, b = result["stored_dispatch"]["gen"], result["stored_dispatch"]["backup"]
        assert all(x is not None for x in g + b)
        assert all(-1e-7 <= x <= p_nom + 1e-7 for x in g)
        assert all(-1e-7 <= x <= 10 + 1e-7 for x in b)
        assert all(abs(x + y - LOAD) < 1e-7 for x, y in zip(g, b))
        total = math.fsum(g)
        cost = math.fsum(x * c + y for x, c, y in zip(g, COSTS, b))
        wanted = [0, 0, 0, .5, .5, .5] if case == "original" else [.5] * N
        assert all(abs(x-y) < 1e-7 for x, y in zip(g, wanted))
        assert abs(total-energy) < 1e-7
        assert abs(cost-(10.5 if case == "original" else 22.5)) < 1e-7
        result.update(whole_witness_valid=True, total_energy=total, whole_cost=cost,
                      native_objective=float(n.objective),
                      native_objective_scope="full_horizon" if mode == "full_horizon"
                                             else "last_window_only")
    else:
        result.update(whole_witness_valid=False, total_energy=None, whole_cost=None,
                      committed_stop_before_failure=trace[-1]["start"])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    # Exact small arithmetic contracts for the two failure mechanisms.
    assert 1.5 - 2 * 1 == -.5 and 1.5 > 2 * LOAD
    assert 3 - 3 * .5 == 1.5 and 1.5 > 2 * .5
    assert 3 - 4 * .5 == 1.0
    versions = {p: metadata.version(p) for p in
                ["pypsa", "linopy", "highspy", "numpy", "scipy", "pandas", "xarray"]}
    versions.update(python=platform.python_version(), source_sha=SOURCE_SHA,
                    source_module=pypsa.__file__)
    (args.out / "versions.json").write_text(json.dumps(versions, indent=2))
    results = []
    for case, modes in EXPECTED.items():
        for mode in modes:
            (args.out / "state.json").write_text(json.dumps(
                {"state": "RUNNING", "case": case, "mode": mode,
                 "completed": len(results)}, indent=2))
            result = run(case, mode)
            (args.out / f"{case}--{mode}.json").write_text(
                json.dumps(result, indent=2, allow_nan=False))
            results.append(result)
            print(case, mode, result["status"], result["whole_cost"], flush=True)
    report = {"status": "PASS", "native_runs": len(results),
              "complete_witnesses": sum(r["whole_witness_valid"] for r in results),
              "expected_native_failures": sum(not r["whole_witness_valid"] for r in results),
              "process_peak_rss_KiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "results": results}
    (args.out / "results.json").write_text(json.dumps(report, indent=2, allow_nan=False))
    (args.out / "state.json").write_text(json.dumps(
        {"state": "DONE", "status": "PASS", "completed": len(results)}, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "results"}), flush=True)


if __name__ == "__main__":
    main()
