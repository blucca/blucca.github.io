# Recorded native results

One original OA master, HiGHS `725b40f68247d0e2a00fa4f29d6ca6bde01bd151`,
Clang 17.0.6, Debian Linux x86-64 AMD EPYC, two solver threads.

The primary timing comparison is three alternating candidate default/false
pairs. Stock, explicit true, and constant-off are single functional controls.
`Highs::run()` wall includes presolve and solve; model loading is separate.
CPU covers the run across process threads; RSS is the complete probe peak.

## Every recorded run

| Run | Run wall s | Run CPU s | Process RSS MiB | Rounded centre synch s |
|---|---:|---:|---:|---:|
| stock-1 | 10.950216 | 12.892924 | 477.98 | 1.9 |
| default-1 | 11.152290 | 13.003454 | 476.89 | 2.0 |
| false-1 | 7.657434 | 7.661750 | 381.66 | 0.0 |
| default-2 | 11.835025 | 13.823338 | 481.03 | 1.9 |
| false-2 | 9.036120 | 9.041738 | 381.66 | 0.0 |
| default-3 | 12.424219 | 14.377265 | 480.90 | 1.5 |
| false-3 | 7.966344 | 7.967615 | 381.63 | 0.0 |
| true-1 | 11.380690 | 13.261321 | 481.73 | 2.1 |
| control-1 | 9.289932 | 9.295953 | 381.77 | 0.0 |

Group medians are **11.835025 → 7.966344 s** for full run wall,
**13.823338 → 7.967615 CPU s**, and **480.90 → 381.66 MiB** process peak.
`1 - median(false)/median(default)` gives **32.7%** observed wall reduction.
The three individual paired wall reductions are **31.34%, 23.65%, 35.88%**.

## Native phase table

Native Solving report values are rounded to two decimals. Column medians
are computed independently. Postsolve reports 0.00 s for all nine runs.

| Run | Native Total s | Presolve s | Solve s |
|---|---:|---:|---:|
| stock-1 | 10.93 | 4.84 | 6.09 |
| default-1 | 11.14 | 5.09 | 6.04 |
| false-1 | 7.64 | 3.67 | 3.97 |
| default-2 | 11.82 | 5.62 | 6.20 |
| false-2 | 9.02 | 4.97 | 4.05 |
| default-3 | 12.41 | 6.41 | 6.00 |
| false-3 | 7.95 | 4.01 | 3.94 |
| true-1 | 11.36 | 4.99 | 6.37 |
| control-1 | 9.27 | 4.88 | 4.39 |
| **default group median** | **11.82** | **5.62** | **6.04** |
| **false group median** | **7.95** | **4.01** | **3.97** |

The Solve-phase savings per pair are **2.07, 2.15, 2.06 s**.
Default centre synch waits are **2.0, 1.9, 1.5 s**; false/control
centre starts and synch waits are **0**. Presolve timings also vary,
as shown above. The complete-run observation and stable approximately
two-second Solve/centering measurements are separate results.

## Full-model quality

All nine solves report native Optimal within the original 1e-4 relative-gap
tolerance, with the same:
- Primal: `59.18414206757198`; native dual bound: `59.17899184159438`.
- Relative gap: `8.702037062092358e-5`.
- 4,020 LP iterations; 183 final cuts; one node.
- Original model: 98,911 rows, 51,291 columns, 19,740 binaries.
- Independent maximum row violation: `2.8199664825478976e-14`.
- Independent bound and integer violations: `0`.
- Independent objective difference: `2.1024848528838902e-15`.

The native CLI also passes the original options-file false case, returns
Optimal with the same primal/dual/gap and dimensions, and emits **0 bytes**
to stdout and stderr under `output_flag=false`. Its receipt is included
in [observed-results.json](observed-results.json).

Lynth-KR identified the wait and supplied the original **22%** constant-off
observation. Our records are the independent native replay and option
prototype, with source, data URL, and full checks supplied for reproduction.
