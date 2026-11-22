# Three small column fixings can exceed one row's tolerance

HiGHS issue [3768](https://github.com/ERGO-Code/HiGHS/issues/3768) supplies a complete feasible model that HiGHS 1.16/latest declares infeasible with default presolve. The reporter supplied the model, cross-solver objective and rule-15/16 workarounds. This study identifies a shared presolve reduction that excludes its feasible point.

One row allows total activity **1e-6**. After enumeration/probing tighten bounds, `checkColBounds` treats three positive-width continuous intervals as fixed, and `colPresolve` chooses each lower bound:

| Column | Interval | Row coefficient | Activity added by choosing lower |
|---|---:|---:|---:|
| x108 | [-1e-6/6, 0] | -6 | 1e-6 |
| x116 | [-1e-6/6, 0] | -6 | 1e-6 |
| x323 | [-1e-6/10, 0] | -10 | 1e-6 |

Their combined activity is **3e-6**, beyond the row's **1e-6** allowance. The original feasible point has all three at zero. Both domain-propagation preparations are feasible; the subsequent individual column fixings cause the failure.

## Shared source change

[apply_fix.py](apply_fix.py) changes one `HPresolve::checkColBounds` condition: **positive-width intervals stay live**. The existing nonpositive-width infeasibility/infinite-bound guards remain. The original model, fixed integer and default presolve settings stay unchanged. Narrow continuous columns are left for subsequent optimization instead of collapsed independently.

## Actual complete-model result

On pinned source **725b40f68247d0e2a00fa4f29d6ca6bde01bd151**, Linux/Clang 17 Release, one solver thread:

- Instrumented stock default: **Infeasible**.
- Candidate default, original MIP: **Optimal 127.19987280000001**.
- Candidate LP control, only fixed x363 made continuous: **Optimal, same objective**.
- Independent original-input checks cover **13 rows, 364 bounds, the fixed integer and the full objective**. The candidate's expected-objective difference is 1e-14.

The reporter's description says seven rows; the supplied MPS contains thirteen constraints (seven L and six G). Published observations use the full supplied input. Earlier release controls and the separate presolve-off tolerance result will accompany the completed report.

## Exact optimality

[The certificate](exact-optimality-certificate.json) and [59-line checker](exact_optimality_check.py) use rational arithmetic, the original MPS and no solver. Row multipliers are **r11=5.4, r12=5.2**, all others zero. All 364 reduced-cost/bound directions and complementary slackness conditions pass. The sparse primal is x158=11.999988 and x354=-11.999988, all other columns zero.

Primal = dual lower bound = **158999841 / 1250000 = 127.1998728**, exact gap zero. The only integer column is fixed to zero, so this instance's LP and MIP feasible sets coincide.

## Reproduce

Prerequisites: Linux, Git, curl, Python 3, CMake, and a C++17 compiler. Our measured build used Clang 17/CMake 3.31.6. The script uses two build workers, per-stage timeouts and fresh output under your workspace temp directory.

```sh
CC=clang-17 CXX=clang++-17 bash replay.sh "$PWD/temp/highs-width-replay"
```

The script downloads the pinned HiGHS source and the [reporter's original MPS](https://github.com/user-attachments/files/35226594/highs_presolve_infeasible.mps.txt), builds an instrumented stock probe, retains its executable, applies the shared fix, then checks the full original model, one tiny LP/MIP pair and the repository's existing presolve test tags. Each result includes native status and validity; invalid solutions have no exported primal. See `state.txt`, logs and JSON results in the requested directory.

The tiny pair has three x in [-t,0], `-sum(x) <= 1.5t`, and minimizes `-sum(x)`. The exact optimum is all zero. The MIP adds a fixed zero integer. Each variant uses its solver's default feasibility tolerance. Stock outcomes are retained as observations.

**Local publication preparation:** the full candidate model and exact certificate have passed; the completed report will include the actual tiny and existing-presolve-test results before release.

## Scope and attribution

This is an independent source repair and numerical study, built with Codex at Blucca. Original failure/model/workaround discovery belongs to hodangkhoinguyen; HiGHS belongs to its authors under MIT. This directory's study code is MIT. The original MPS is fetched from its author's URL for reproduction and is not mirrored here. The supplied model and declared tests define the measured coverage; upstream adoption and the reporter's own replay are tracked separately.
