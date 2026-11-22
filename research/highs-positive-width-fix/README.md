# Three small column fixings can exceed one row's tolerance

HiGHS issue [3768](https://github.com/ERGO-Code/HiGHS/issues/3768) supplies a complete feasible model that HiGHS 1.16/latest declares infeasible with default presolve. The reporter supplied the model, cross-solver objective and rule-15/16 workarounds. This study identifies a shared presolve reduction that excludes its feasible point.

One row allows total activity **1e-6**. After enumeration/probing tighten bounds, the stock shared `checkColBounds` treats three positive-width continuous intervals as fixed, and `colPresolve` chooses each lower bound:

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

The reporter's description says seven rows; the supplied MPS contains thirteen constraints (seven L and six G). All complete-model checks use the full supplied input.

The existing `[highs_test_presolve],[highs_test_presolve_rules]` tests pass: **744 assertions in 80 test cases**, including LP/MIP/postsolve paths. [The complete observations](observed-results.json) and [raw results/logs](observed/) retain all eight full-model runs and four tiny runs. The explicitly scoped **issue-3768 MIP repair gate passes**. The initially proposed **all-tiny-success gate failed**; its original failure log remains [here](observed/tiny-check.log).

### Earlier release controls

| Full original model / mode | Native result | Objective |
|---|---|---:|
| 1.16.0 default | Infeasible / invalid | — |
| 1.15.1 default | Optimal | 127.19987280000001 |
| 1.16.0 rule 15 disabled | Optimal | 127.19987280000001 |
| 1.16.0 rule 16 disabled | Optimal | 127.19987280000001 |
| 1.16.0 LP control | Optimal | 127.19987280000001 |
| 1.16.0 presolve off | Optimal within native tolerance | 127.19992600200001 |

The presolve-off witness has a maximum original-row residual of approximately **1e-6** and objective difference **0.000053202** from the exact optimum. It remains a separate tolerance-level control. Release controls use Python bindings; the candidate uses the C++ probe. Their wall/RSS values are recorded separately, with no cross-driver speedup claim. Candidate original MIP/LP whole calls take 14.422/0.812 ms on this host; these are single observations, not a broad performance benchmark.

## Exact optimality

[The certificate](exact-optimality-certificate.json) and [source-specific checker](exact_optimality_check.py) use rational arithmetic, the original MPS and no solver. Row multipliers are **r11=5.4, r12=5.2**, all others zero. All 364 reduced-cost/bound directions and complementary slackness conditions pass. The sparse primal is x158=11.999988 and x354=-11.999988, all other columns zero.

Primal = dual lower bound = **158999841 / 1250000 = 127.1998728**, exact gap zero. The only integer column is fixed to zero, so this instance's LP and MIP feasible sets coincide.

## Reproduce

Prerequisites: Linux, Git, curl, Python 3, CMake, and a C++17 compiler. Our measured build used Clang 17/CMake 3.31.6. The script uses two build workers, per-stage timeouts and fresh output under your workspace temp directory.

```sh
CC=clang-17 CXX=clang++-17 bash replay.sh "$PWD/temp/highs-width-replay"
```

The script downloads the pinned HiGHS source and the [reporter's original MPS](https://github.com/user-attachments/files/35226594/highs_presolve_infeasible.mps.txt), checks the rational certificate, builds an instrumented stock probe, retains its executable, applies the shared fix, then checks the full original MIP, its LP control, the declared tiny LP/MIP pair and existing presolve test tags. `-DALL_TESTS=ON` enables the canonical `unit_tests` target. Each result includes native status and validity; invalid solutions have no exported primal. See `state.txt`, logs and JSON results in the requested directory. The script reproduces the pinned repair and scoped tests; the earlier release-control observations are retained separately.

The tiny pair has three x in [-t,0], `-sum(x) <= 1.5t`, and minimizes `-sum(x)`. The exact optimum is all zero. The MIP adds a fixed zero integer. Each variant uses its solver's default feasibility tolerance. Stock outcomes are retained as observations.

**Observed tiny results:** the stock MIP is Infeasible; the candidate MIP is Optimal with all-zero primal/objective0. The pure tiny LP is Infeasible in **both** builds. The inputs and tolerances remain unchanged. `tiny_result_assert.py --mip-scope` requires the candidate MIP optimum and records both LP outcomes plus the failed original all-tiny gate. Invoking the checker without that flag retains the original all-tiny requirement and exits 1 on these observations.

### Why the pure LP still fails

Default LP presolve first runs a separate [`HPresolveInitialSweep`](https://github.com/ERGO-Code/HiGHS/blob/725b40f68247d0e2a00fa4f29d6ca6bde01bd151/highs/presolve/HPresolveInitialSweep.cpp#L34-L55). Its own near-fixed test remains unchanged. With three `[-t,0]` intervals at `t=1e-7`, it also chooses each lower bound: row upper becomes `1.5t - 3t = -1.5t`. Its empty-row check detects infeasibility before execution reaches the modified shared check.

MIP presolve skips that LP-only initial sweep and reaches the shared `checkColBounds`. A fixed integer still classifies the model as MIP. This route explanation is source analysis; the LP/MIP statuses above are the recorded native executions.

The patch changes a shared LP/MIP function; its acceptance scope here is the original issue-3768 default MIP, original LP control, unchanged tiny MIP and existing presolve regressions. **Generic LP repair remains open.** Leaving narrow continuous columns live can increase subsequent reduced-model/LP work; broad corpus performance tuning is outside this study.

## Scope and attribution

This is an independent source repair and numerical study, built with Codex at Blucca. Original failure/model/workaround discovery belongs to hodangkhoinguyen; HiGHS belongs to its authors under MIT. This directory's study code is MIT. The original MPS is fetched from its author's URL for reproduction and is not mirrored here. The supplied model and declared tests define the measured coverage; upstream adoption and the reporter's own replay are tracked separately.
