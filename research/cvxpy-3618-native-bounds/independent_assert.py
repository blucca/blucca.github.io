"""Independent certificate and source-only check of CVXPY issue #3618.

Original model, discovery, and PR #3619 fix: mkolter-96.
Uses the two downloaded, exact-revision bounds.py files; requires numpy/scipy.
Run: python -B independent_assert.py
SPDX-License-Identifier: Apache-2.0
"""

from collections import Counter
from fractions import Fraction as F
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np


HERE = Path(__file__).resolve().parent

def source_module(which):
    filename = HERE / f"bounds-{which}.py"
    spec = importlib.util.spec_from_file_location(f"review_bounds_{which}", filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def objective(x):
    return (F(3, 10) - F(x[0] + x[2], 3)) ** 2 + (
        F(3, 5) - F(x[1] + x[3], 3)
    ) ** 2


points = [
    (x0, x1, x2, 3 - x0 - x1 - x2)
    for x0 in range(4)
    for x1 in range(4 - x0)
    for x2 in range(4 - x0 - x1)
]
assert len(points) == 20
assert all(min(x) >= 0 and sum(x) == 3 for x in points)
optimum = min(map(objective, points))
optimal_points = [x for x in points if objective(x) == optimum]
assert optimum == F(1, 180)
assert len(optimal_points) == 6
assert all(x[0] + x[2] == 1 and x[1] + x[3] == 2 for x in optimal_points)
assert objective((1, 2, 0, 0)) == optimum
assert objective((0, 0, 0, 3)) == F(1, 4)

base, head = source_module("base"), source_module("head")
M = np.array([[1.0, 0.0, 1.0, 0.0], [0.0, 1.0, 0.0, 1.0]])
d = np.array([0.3, 0.6])
lb_x, ub_x = np.full(4, -np.inf), np.full(4, np.inf)


def stages(module):
    mat = module.matmul_bounds(M, M, lb_x, ub_x)
    divided = module.div_bounds(*mat, np.array(3.0), np.array(3.0))
    shifted = module.add_bounds(d, d, *module.neg_bounds(*divided))
    squared = module.power_bounds(*shifted, 2)
    return mat, divided, shifted, squared


with np.errstate(invalid="ignore"):
    base_stages, head_stages = stages(base), stages(head)
assert all(np.isnan(b).all() for b in base_stages[0])
assert all((b == 0).all() for b in base_stages[1])
np.testing.assert_allclose(base_stages[3][0], d**2)
np.testing.assert_allclose(base_stages[3][1], d**2)
for lower, upper in head_stages[:3]:
    assert np.isneginf(lower).all() and np.isposinf(upper).all()
assert (head_stages[3][0] == 0).all()
assert np.isposinf(head_stages[3][1]).all()

# Same original matrix, transposed representation: x @ M.T.
right = head.matmul_bounds(lb_x, ub_x, M.T, M.T)
for actual, expected in zip(right, head_stages[0]):
    np.testing.assert_array_equal(actual, expected)

# The old matmul's actual NaN output must stay unknown in the new division.
unknown = head.div_bounds(*base_stages[0], np.array(3.0), np.array(3.0))
assert np.isneginf(unknown[0]).all() and np.isposinf(unknown[1]).all()


class SquareBounds:
    shape = (2,)

    def __init__(self, bounds):
        self.bounds = bounds

    def get_bounds(self):
        return self.bounds

    def is_nonneg(self):
        return True

    def is_nonpos(self):
        return False


context = SimpleNamespace(solver_supports_bounds=True)
assert base.get_expr_bounds_if_supported(SquareBounds(base_stages[3]), context) is not None
assert head.get_expr_bounds_if_supported(SquareBounds(head_stages[3]), context) is None

print(json.dumps({
    "status": "PASS",
    "feasible_integer_points": len(points),
    "objective_counts": {str(k): v for k, v in sorted(Counter(map(objective, points)).items())},
    "exact_optimum": str(optimum),
    "optimal_points": optimal_points,
    "original_returned_point_objective": str(objective((0, 0, 0, 3))),
    "base_path": "NaN -> [0, 0] -> d -> d^2 fixed auxiliary bounds",
    "head_path": "[-inf, inf] -> square [0, inf] -> auxiliary bounds omitted",
    "same_model_right_operand": "PASS",
    "base_nan_input_through_head_division": "PASS",
    "scope": "20-point exact certificate plus exact bounds.py utility execution; solver runs 0",
}, indent=2))
