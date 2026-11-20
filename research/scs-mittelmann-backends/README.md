# SCS CPU / cuDSS: coverage and paired solve time

An independent score replay of the **37 Mittelmann LPs** in the published
November 2026 SCS 3.3.2 campaign. The full-set headline passes; the paired view
shows how much faster the GPU backend was on the problems both configurations
verified.

| View | SCS CPU | SCS cuDSS GPU |
|---|---:|---:|
| Verified, all 37 problems | 24 | 29 |
| All-problem shifted geometric mean, seconds | 361.141 | 151.902 |
| Shared-success problems | 24 | 24 |
| Shared-success wall-time geometric mean, seconds | 56.117 | 20.770 |

On the **same 24 successful problems**, the geometric mean of CPU/GPU
solver-call time ratios is **2.702×**. The GPU configuration is faster on 20
and the CPU configuration on four: `chromaticindex1024-7`, `datt256_lp`,
`irish-electricity`, and `brazil3`.

All 24 CPU successes are also GPU successes. The five additional GPU successes
are `Dual2_5000`, `a2864`, `Primal2_1000`, `L1_sixm250obs`, and `Linf_520c`.
Eight problems fail acceptance in both configurations. The complete partition
and per-problem times are in [observed-results.json](observed-results.json).

**Use both views.** Keep the full 37-problem score to account for failures and
coverage; use the paired-success ratio to describe latency on a shared set.
The paired set is selected by both configurations succeeding. For a workload
containing the five GPU-only successes, coverage is part of the benefit.

## Reproduce

Python 3 standard library only:

```sh
python replay.py > replayed.json
```

The script reads the pinned public source. To use an already downloaded copy:

```sh
python replay.py path/to/results.jsonl > replayed.json
```

The six small controls and the fixed-campaign assertions run with the replay.
The full partition, counts and geometric means were also checked independently
with Decimal arithmetic against the original records.

## Acceptance and scope

- Select `scs_cpu_1e-4` and `scs_cudss_1e-4`, each with exactly the same 37
  `(dataset, problem)` keys; requested tolerance is `1e-4`.
- Score the **published KKT residuals**: finite absolute primal, dual and gap
  relative residuals each below `1e-3`, and a finite nonnegative solver-call
  `run_time_seconds` at most **1800 + 60 seconds**. Reported status is retained
  alongside acceptance.
- The full-set metric floors accepted times at 0.01 s, uses a 10 s shift, and
  charges a failure 5400 s. The paired ratio uses accepted solver-call times.
- `L1_sixm250obs` is a useful boundary case: the GPU record reports
  `optimal_inaccurate` at 1846.603 s, with maximum relative KKT residual
  `7.979e-5`, and passes under the campaign's 60 s grace rule.
- CPU: four reserved Milan cores and MKL Pardiso. GPU: A100-SXM4-80GB, eight
  Milan host cores and cuDSS 1.0.0, using the campaign's factorization settings.
  These are comparisons of those published backend configurations.

This is a replay of stored measurements and residuals. Source problem data,
solver execution and the original residual calculations belong to the
published campaign.

## Sources

- [SCS benchmark documentation](https://github.com/cvxgrp/scs/blob/f0036c3aea2b8e3d371f3c5e2ea23a1639ee8354/docs/src/benchmarks/index.rst), merged in [PR #526](https://github.com/cvxgrp/scs/pull/526).
- [Campaign manifest](https://github.com/bodono/solver_benchmarks_results/blob/3186dfa179c07e7d032bed9ff2cdf930c6f29f3f/scs332_2026-11/MANIFEST.md).
- [Original records](https://github.com/bodono/solver_benchmarks_results/blob/3186dfa179c07e7d032bed9ff2cdf930c6f29f3f/scs332_2026-11/merged/mittelmann/results.jsonl), selected from 444 published runs across all solvers/tolerances.

The original records remain at their author's source. This directory contains
our original replay and derived numerical results. Replay by Sol / Blucca,
2026-11-21; [MIT](../../LICENSE).
