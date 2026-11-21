#!/usr/bin/env python3
"""Exact certificate for Cbc issue 861's original six-column continuous LP.

Uses Fraction and the Python standard library for this exact LP.
"""
from fractions import Fraction as F
import json
from pathlib import Path
import sys


A = (
    (2, 0, 0, 0, 0, 0),
    (0, 2, 0, 0, 0, 0),
    (0, 0, 3, 0, 0, 0),
    (0, 0, 0, 7, 0, 2),
    (0, 0, 0, 0, 10, 0),
)
B = tuple(map(F, (310, 120, 45, 32, 103)))
C = (F(1),) * 6


def dot(left, right):
    assert len(left) == len(right)
    return sum((F(a) * F(b) for a, b in zip(left, right)), F(0))


def numbers(values):
    return {"exact": [str(v) for v in values],
            "float": [float(v) for v in values]}


def analyze(b, x, pi):
    activity = tuple(dot(row, x) for row in A)
    slack = tuple(a - rhs for a, rhs in zip(activity, b))
    dj = tuple(C[j] - dot(tuple(row[j] for row in A), pi)
               for j in range(6))
    x_dj = tuple(v * r for v, r in zip(x, dj))
    pi_slack = tuple(p * s for p, s in zip(pi, slack))
    primal_obj, dual_obj = dot(C, x), dot(b, pi)
    gap = primal_obj - dual_obj
    # The original-model primal/dual gap decomposition is exact.
    assert gap == sum(x_dj, F(0)) + sum(pi_slack, F(0))
    return {
        "b": numbers(b), "x": numbers(x), "pi": numbers(pi),
        "activity": numbers(activity), "coverage_slack_Ax_minus_b": numbers(slack),
        "dj_c_minus_AT_pi": numbers(dj),
        "variable_complementarity_x_times_dj": numbers(x_dj),
        "row_complementarity_pi_times_slack": numbers(pi_slack),
        "primal_feasible": all(v >= 0 for v in x) and all(s >= 0 for s in slack),
        "dual_feasible": all(p >= 0 for p in pi) and all(r >= 0 for r in dj),
        "complementary": all(v == 0 for v in x_dj + pi_slack),
        "primal_objective_exact": str(primal_obj),
        "primal_objective_float": float(primal_obj),
        "dual_objective_exact": str(dual_obj),
        "dual_objective_float": float(dual_obj),
        "gap_exact": str(gap), "gap_float": float(gap),
    }


def construct_original_solution(b):
    # The original diagonal columns cover each row. Column 5 has cost 1 and
    # yields only 2 units of row 3, versus 7 from column 3 at the same cost.
    x = tuple(b[j] / A[j][j] for j in range(5)) + (F(0),)
    pi = tuple(F(1, A[j][j]) for j in range(5))
    return x, pi


def main():
    x, pi = construct_original_solution(B)
    original = analyze(B, x, pi)
    assert original["primal_feasible"] and original["dual_feasible"]
    assert original["complementary"] and original["gap_exact"] == "0"
    assert x == (F(155), F(60), F(15), F(32, 7), F(103, 10), F(0))
    assert pi == (F(1, 2), F(1, 2), F(1, 3), F(1, 7), F(1, 10))
    assert original["dj_c_minus_AT_pi"]["exact"] == ["0", "0", "0", "0", "0", "5/7"]
    assert dot(C, x) == dot(B, pi) == F(17141, 70)

    reported_pi = (F(0), F(0), F(0), F(1, 7), F(1, 10))
    reported = analyze(B, x, reported_pi)
    assert reported["primal_feasible"] and reported["dual_feasible"]
    assert not reported["complementary"]
    assert reported["dj_c_minus_AT_pi"]["exact"] == ["1", "1", "1", "0", "0", "5/7"]
    assert dot(B, reported_pi) == F(1041, 70)
    assert dot(C, x) - dot(B, reported_pi) == F(230)
    assert reported["variable_complementarity_x_times_dj"]["exact"] == ["155", "60", "15", "0", "0", "0"]
    reported["reported_dj_values_in_issue"] = None
    reported["stationarity_note"] = (
        "The issue supplies pi but no numerical dj. Given that pi, stationarity "
        "forces dj[0:3]=1; positive original x[0:3] then violates x*dj=0. "
        "If returned dj[0:3]=0 instead, c-A^T*pi-dj has residual (1,1,1).")

    # CBC 87e3a7d moved all four singleton-row costs to tightened bounds.
    # The original issue kept the fifth row's price; retain both observations.
    current_pi = (F(0), F(0), F(0), F(1, 7), F(0))
    current = analyze(B, x, current_pi)
    assert current["gap_exact"] == "2403/10"
    assert current["variable_complementarity_x_times_dj"]["exact"] == ["155", "60", "15", "0", "103/10", "0"]

    b_plus = (B[0] + 1,) + B[1:]
    x_plus, pi_plus = construct_original_solution(b_plus)
    perturbed = analyze(b_plus, x_plus, pi_plus)
    delta = dot(C, x_plus) - dot(C, x)
    assert perturbed["primal_feasible"] and perturbed["dual_feasible"]
    assert perturbed["complementary"] and perturbed["gap_exact"] == "0"
    assert x_plus[0] == F(311, 2) and x_plus[1:] == x[1:]
    assert pi_plus == pi and delta == F(1, 2)
    assert dot(C, x_plus) == F(8588, 35)
    perturbed.update({"changed_row_zero_based": 0, "old_rhs": 310, "new_rhs": 311,
                      "delta_objective_exact": str(delta), "delta_objective_float": float(delta)})

    certificate = {
        "source": "https://github.com/coin-or/Cbc/issues/861",
        "model": {"sense": "minimize", "objective": "sum(x[j])",
                  "A": A, "b": [int(v) for v in B], "c": [1] * 6,
                  "row_senses": [">="] * 5, "lower_bounds": [0] * 6,
                  "upper_bounds": [None] * 6, "variables": "continuous",
                  "column_order_zero_based": list(range(6)),
                  "dual_convention": "pi >= 0, A^T*pi <= c; dj = c - A^T*pi"},
        "original_optimal_certificate": original,
        "reported_pi_on_original_lp": reported,
        "pinned_master_pi_on_original_lp": current,
        "finite_rhs_plus_one_certificate": perturbed,
        "exact_assertions": "PASS; all feasibility, gap and KKT checks use Fraction",
        "native_comparison": {
            "absolute_tolerance": 1e-6,
            "applies_to": ["pi", "dj", "Ax-b", "c-A^T*pi-dj", "x*dj",
                           "pi*(Ax-b)", "primal_dual_gap", "RHS+1 objective delta"],
            "reason": "Allow CBC/PuLP solution-text decimal serialization; this rational certificate uses exact equality.",
            "slack_convention": "This file uses Ax-b >= 0; check PuLP's reported slack sign before comparing.",
        },
        "scope": "Author original six columns and five covering rows, with one RHS+1 sensitivity check.",
    }
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("certificate.json")
    destination.write_text(json.dumps(certificate, indent=2) + "\n")
    print("PASS original z=17141/70; reported-pi gap=230; row0 RHS+1 delta=1/2")
    print(destination)


if __name__ == "__main__":
    main()
