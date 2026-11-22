"""Exact certificate check for the original HiGHS3768 MPS; no solver calls."""
from fractions import Fraction as F
from pathlib import Path
import json
import sys
from check_original import load_mps


def verify(source, certificate):
    cert = json.loads(Path(certificate).read_text())
    kinds, rows, rhs, bounds, costs, integer = load_mps(source)
    names = [r for r in kinds if kinds[r] != "N"]
    nz = sum(len(rows[r]) for r in names)
    assert (len(names), len(bounds), nz) == (13, 364, 786)
    assert integer == {"x363"} and bounds["x363"] == [F(0), F(0)]
    x = {c: F(cert["primal_nonzero"].get(c, "0")) for c in bounds}
    y = {r: F(cert["row_duals"].get(r, "0")) for r in names}
    assert set(cert["primal_nonzero"]) <= set(bounds)
    assert set(cert["row_duals"]) == set(names)
    primal = sum(F(costs.get(c, 0)) * x[c] for c in bounds)
    dual = F(0)
    reduced = {c: F(costs.get(c, 0)) for c in bounds}
    for c, (lo, hi) in bounds.items():
        assert (not lo.is_finite() or x[c] >= F(lo))
        assert (not hi.is_finite() or x[c] <= F(hi))
        if c in integer:
            assert x[c].denominator == 1
    for r in names:
        b = F(rhs.get(r, 0))
        activity = sum(F(a) * x[c] for c, a in rows[r].items())
        assert kinds[r] in ("L", "G")
        assert (activity <= b and y[r] <= 0) if kinds[r] == "L" else (activity >= b and y[r] >= 0)
        assert y[r] * (activity - b) == 0
        dual += y[r] * b
        for c, a in rows[r].items():
            reduced[c] -= F(a) * y[r]
    assert set(cert["reduced_costs"]) == set(bounds)
    for c, rc in reduced.items():
        assert rc == F(cert["reduced_costs"][c])
        if rc == 0:
            continue
        edge = bounds[c][0 if rc > 0 else 1]
        assert edge.is_finite(), (c, "dual bound direction")
        dual += rc * F(edge)
        assert rc * (x[c] - F(edge)) == 0
    expected = F("127.1998728")
    assert primal == dual == expected
    assert primal == F(cert["exact_objective"]["fraction"])
    return {"pass": True, "scope": "original 3768 MPS only; LP=MIP since x363=0",
            "rows": len(names), "columns": len(bounds), "matrix_entries": nz,
            "primal": str(primal), "dual_lower_bound": str(dual), "gap": "0",
            "exact_decimal_objective": "127.1998728"}


if __name__ == "__main__":
    print(json.dumps(verify(*sys.argv[1:3]), indent=2))
