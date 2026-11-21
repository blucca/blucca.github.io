"""Full native replay of CVXPY #3618 and PR #3619's weighted-L1 test.

Original models and bounds fix: mkolter-96. Independent replay: Blucca.
SPDX-License-Identifier: Apache-2.0
Run serially with --mode base, then --mode head, in the pinned base environment.
"""
import argparse
import importlib.metadata as metadata
import importlib.util
import json
import math
from pathlib import Path
import time

import numpy as np
import scipy.sparse as sp

HERE = Path(__file__).resolve().parent
BASE = "0fc467a64a66f5a0f3b7cc721779dca5f1b7ce6f"
HEAD = "1d5509bf5a78084e252e1a852382b598fe9020d7"


def plain(value):
    if isinstance(value, np.ndarray):
        return plain(value.tolist())
    if isinstance(value, np.generic):
        return plain(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return "NaN" if math.isnan(value) else ("+inf" if value > 0 else "-inf")
    if isinstance(value, (set, frozenset)):
        return plain(sorted(value))
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if sp.issparse(value):
        a = value.tocoo()
        return {"shape": list(a.shape), "row": a.row.tolist(),
                "col": a.col.tolist(), "data": plain(a.data)}
    return value


def solver_data(problem, solver):
    data = problem.get_problem_data(solver)[0]
    result = {k: data[k] for k in ("c", "A", "b", "lower_bounds", "upper_bounds",
                                   "bool_vars_idx", "int_vars_idx") if k in data}
    # These two models use conic inputs; record the cone partition with the matrix.
    result["dims"] = {k: getattr(data["dims"], k)
                      for k in ("zero", "nonneg", "exp", "soc", "psd", "p3d")}
    return plain(result)


def solve(problem, variable, solver):
    start = time.perf_counter()
    error = None
    try:
        options = {"threads": 1, "time_limit": 10.0} if solver == "HIGHS" else {}
        problem.solve(solver=solver, **options)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    return plain({"solver": solver, "status": problem.status, "value": problem.value,
                  "x": variable.value, "seconds": time.perf_counter() - start,
                  "error": error})


def replay(cp, mode):
    M = np.array([[1., 0., 1., 0.], [0., 1., 0., 1.]])
    d = np.array([0.3, 0.6])
    x = cp.Variable(4, integer=True)
    expressions = {"x": x, "M@x": M @ x, "M@x/3": M @ x / 3,
                   "d-M@x/3": d - M @ x / 3,
                   "square(d-M@x/3)": cp.square(d - M @ x / 3)}
    chain = {name: plain(expr.get_bounds()) for name, expr in expressions.items()}
    problem = cp.Problem(cp.Minimize(cp.sum(expressions["square(d-M@x/3)"])),
                         [x >= 0, cp.sum(x) == 3])
    integer = {"input": {"M": M.tolist(), "d": d.tolist(), "sum_x": 3},
               "bounds": chain, "solver_data": solver_data(problem, cp.SCIP),
               "solve": solve(problem, x, cp.SCIP)}
    if x.value is not None:
        integer["original_objective"] = float(np.sum((d - M @ x.value / 3) ** 2))
        integer["primal_feasible"] = bool(np.min(x.value) >= -1e-6 and
                                         abs(np.sum(x.value) - 3) < 1e-6 and
                                         np.max(abs(x.value - np.rint(x.value))) < 1e-6)

    # Exactly the author's test_weighted_abs_dense_matrix, default_rng(1), 20x4.
    rng = np.random.default_rng(1)
    A, b, w = rng.normal(size=(20, 4)), rng.normal(size=20), rng.uniform(0.5, 2., size=20)
    l1 = {"input": plain({"A": A, "b": b, "w": w}), "solves": {}}
    for solver in (cp.HIGHS, cp.CLARABEL):
        v = cp.Variable(4)
        p = cp.Problem(cp.Minimize(cp.sum(cp.abs(cp.multiply(w, A @ v - b)))))
        if solver == cp.HIGHS:
            l1["solver_data"] = solver_data(p, solver)
        item = solve(p, v, solver)
        if v.value is not None:
            item["original_objective"] = float(np.sum(np.abs(w * (A @ v.value - b))))
            item["objective_agrees"] = bool(np.isclose(item["value"], item["original_objective"],
                                                        atol=1e-7, rtol=1e-7))
        l1["solves"][solver] = item
    # Keep complete observations even if a later acceptance assertion fails.
    observation = {"mode": mode, "check": "RECORDED", "integer_model": integer,
                   "weighted_l1": l1}
    (HERE / f"native-{mode}.json").write_text(json.dumps(plain(observation), indent=2,
                                                       allow_nan=False) + "\n")
    if mode == "base":
        assert integer["solve"]["status"] == cp.OPTIMAL and integer["primal_feasible"]
        assert not np.isclose(integer["original_objective"], 1 / 180, atol=1e-6)
        assert l1["solves"][cp.HIGHS]["status"] == cp.INFEASIBLE
        assert l1["solves"][cp.CLARABEL]["status"] == cp.OPTIMAL
    else:
        assert integer["solve"]["status"] == cp.OPTIMAL and integer["primal_feasible"]
        assert np.isclose(integer["original_objective"], 1 / 180, atol=1e-6)
        a, c = l1["solves"][cp.HIGHS], l1["solves"][cp.CLARABEL]
        assert a["status"] == c["status"] == cp.OPTIMAL
        assert a["objective_agrees"] and c["objective_agrees"]
        assert np.isclose(a["value"], c["value"], rtol=1e-5)
    return {"mode": mode, "check": "PASS", "cvxpy_base": BASE,
            "bounds_revision": BASE if mode == "base" else HEAD,
            "packages": {k: metadata.version(k) for k in
                         ("cvxpy", "numpy", "scipy", "highspy", "pyscipopt", "clarabel")},
            "integer_model": integer, "weighted_l1": l1}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("base", "head"), required=True)
    args = parser.parse_args()
    assert plain(np.array([np.inf, -np.inf, np.nan])) == ["+inf", "-inf", "NaN"]
    assert plain({2, 1}) == [1, 2]
    source = json.loads(metadata.distribution("cvxpy").read_text("direct_url.json"))
    assert source["vcs_info"]["commit_id"] == BASE, source
    target = Path(importlib.util.find_spec("cvxpy").origin).parent / "utilities" / "bounds.py"
    original = target.read_bytes()
    assert original == (HERE / "bounds-base.py").read_bytes(), "Expected pinned base bounds.py"
    try:
        if args.mode == "head":
            target.write_bytes((HERE / "bounds-head.py").read_bytes())
        import cvxpy as cp
        result = replay(cp, args.mode)
        (HERE / f"native-{args.mode}.json").write_text(json.dumps(plain(result), indent=2,
                                                                allow_nan=False) + "\n")
        print(json.dumps({"mode": args.mode, "check": result["check"],
                          "integer": result["integer_model"]["solve"],
                          "l1": result["weighted_l1"]["solves"]}, indent=2))
    finally:
        target.write_bytes(original)
