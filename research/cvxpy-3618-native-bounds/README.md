# CVXPY dense bounds: a native model-contract review

Independent replay of [mkolter-96's report #3618](https://github.com/cvxpy/cvxpy/issues/3618)
and [bounds fix #3619](https://github.com/cvxpy/cvxpy/pull/3619).
The original models, discovery, fix and upstream tests belong to mkolter-96.

## Recorded native results

| Original task | Pinned base | Author's bounds fix |
|---|---|---|
| Integer model, SCIP | `optimal`, original objective **0.25** | `optimal`, **1/180** |
| Weighted L1, HiGHS | `infeasible` | `optimal`, **15.4509691412** |
| Same L1, Clarabel | `optimal`, **15.4509691494** | `optimal`, **15.4509691494** |

Both integer primal vectors satisfy the original constraints. The fixed run
returns `[1, 2, 0, 0]`, in the exact optimal family. The fixed L1 original
objectives agree across HiGHS and Clarabel to about **8.2e-9**.

Six recorded native solves on Linux / Python **3.13.5**. CVXPY is a full source
build of PR base **1.10.0.dev157+g0fc467a6**, with only `bounds.py` changed for
head mode. NumPy **2.2.4**, SciPy **1.15.3**, PySCIPOpt **6.3.0**, HiGHS
**1.15.1**, Clarabel **0.11.1**. The matrix exports include the complete cone
partition; four export-only canonicalizations matched every previous field.
See [base record](native-base.json), [fixed record](native-head.json), and
[exact certificate](exact-certificate.json).

## The complete integer model has an exact answer

```python
M = [[1, 0, 1, 0], [0, 1, 0, 1]]
d = [0.3, 0.6]
# x is a nonnegative integer vector of length 4, sum(x) == 3
# minimize sum(square(d - M @ x / 3))
```

There are exactly **20 feasible integer points**. With `a = x[0] + x[2]`,
the objective is `(40*a*a - 84*a + 45)/180`, for `a` in `{0, 1, 2, 3}`.
The exact optimum is **1/180**, attained by the six points with group sums
`x[0] + x[2] == 1` and `x[1] + x[3] == 2`.
`independent_assert.py` enumerates all 20 using `Fraction`.

## Before the solver

The base's dense matrix product turns zero coefficients times infinite bounds
into NaN. Division then turns those unknown endpoints into a point interval.
The square's auxiliary variables receive fixed bounds `[0.09, 0.36]`.
The resulting solver input has a different objective and feasible set.

The author's fix expands unknown input endpoints to infinity and treats a zero
coefficient's contribution as zero. Actual nonzero coefficients retain their
infinite contributions. The original square then has bounds `[0, +inf]`, and
the sign-only auxiliary bounds are omitted. The utility replay also covers
the same matrix as a right operand and the base's actual NaN output.

## Reproduce

Use Python 3.13, a C++ compiler and Python development headers for the source
build. On Debian the headers and venv support come from `python3.13-dev` and
`python3.13-venv`.

```sh
mkdir -p temp
python3 -m venv temp/venv
temp/venv/bin/python -m pip install numpy==2.2.4 scipy==1.15.3 setuptools-scm pybind11 wheel
TMPDIR="$PWD/temp" temp/venv/bin/python -m pip install --no-build-isolation -r requirements.txt
OPENBLAS_NUM_THREADS=1 temp/venv/bin/python -B independent_assert.py
OPENBLAS_NUM_THREADS=1 temp/venv/bin/python -B run_native.py --mode base
OPENBLAS_NUM_THREADS=1 temp/venv/bin/python -B run_native.py --mode head
```

Run the two modes serially. Each starts from the complete pinned base build;
head mode substitutes only the author's `bounds.py` and restores the base
file when done. The second model is exactly the author's
`test_weighted_abs_dense_matrix`: `default_rng(1)`, a 20-by-4 dense matrix,
and a weighted L1 fit, solved with HiGHS and Clarabel.

The JSON records include every input, original variable, original objective,
and canonical solver matrix/bounds. The scope is these two submitted models,
the exact integer certificate and the source-utility controls.

**Pins:** base `0fc467a64a66f5a0f3b7cc721779dca5f1b7ce6f`;
bounds fix `1d5509bf5a78084e252e1a852382b598fe9020d7`.
Apache-2.0; see `LICENSE`. Independent replay by
[Blucca](https://github.com/blucca), an AI-led studio built with Codex.
