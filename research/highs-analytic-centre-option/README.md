# HiGHS: explicitly optional MIP analytic centering

[Lynth-KR’s #3761](https://github.com/ERGO-Code/HiGHS/issues/3761) supplies an
outer-approximation master and identifies a 2-second wait for IPX centering.
Their constant-off experiment gives the same solution and search path, 22%
faster. This independent replay turns that control into a small, default-on
**research option**, `mip_compute_analytic_centre`, and checks the full uploaded
model against stock and the author’s constant-off control.

The complete **98,911-row / 51,291-column / 19,740-binary** master passes all
nine native primal checks. On two-thread AMD EPYC, three alternating
default/false pairs give these observed group medians:

| Metric | Default on | Option off |
|---|---:|---:|
| Full `Highs::run()` wall | 11.835 s | 7.966 s |
| Native Solve phase | 6.04 s | 3.97 s |
| Native Presolve phase | 5.62 s | 4.01 s |
| Run process CPU | 13.823 s | 7.968 s |
| Process peak RSS | 480.90 MiB | 381.66 MiB |

Full-run group-median wall reduction is **32.7%**; individual pairs give
23.6–35.9%. The Solve phase saves a consistent **2.06–2.15 s** per pair and
centering synchronization disappears. Presolve timing also varies; the full
run and phase measurements are reported separately in [RESULTS.md](RESULTS.md).

All nine runs retain primal **59.18414206757198**, native dual bound
**59.17899184159438**, gap **8.702037e-5**, **4,020 LP iterations, 183 final
cuts and one node**. Full long-double recomputation gives maximum row
violation **2.82e-14**, bound/integer violations **0**, objective delta
**2.10e-15**. Native CLI/options-file and quiet-output checks also pass.

## Reproduce

Requires Linux, GCC or Clang, CMake, Git, curl, Python 3, and network access.
From this folder, give a fresh output directory under your workspace `temp/`:

```sh
CC=clang-17 CXX=clang++-17 bash replay.sh "$PWD/temp/highs3761"
```

The script fetches pinned HiGHS source and the original public attachment,
builds stock, builds the candidate, checks option default/string/copy/reset
and options-file handling, and runs nine complete probe solves. Candidate default
and false runs are interleaved three times on the same two-thread binary;
explicit true and the independently compiled constant-off control are also
checked. A final ordinary `highs --options_file` solve verifies the native CLI
and quiet output. The working source/library is restored to the candidate
after the constant-off control. Generated models, source, binaries, logs and results stay in that
output directory. The probe keeps its assertions enabled in Release builds.
Each solver call has a 120-second resource ceiling and a 150-second process
ceiling. The MIP gap and feasibility tolerances retain their native defaults.

`summary.json` contains every result and the same-binary timing comparison.
The scripts stop on a failed native build or primal check. The 10% timing
case gate is reported separately from correctness.

## Mechanism

The pinned source starts an IPX centering task with zero objective,
presolve off, `run_centring=true`, and a fixed 200-iteration ceiling. The main
thread joins it after five separation rounds or on subsequent root exits.
The resulting point can supply bound fixings and central rounding.

The candidate replaces the one shared `compute_analytic_centre=true` control
with a registered bool, default **true**, so the existing start/finish guards
remain together. False skips the computation and its dependent use. It also
removes the old constant-off debug `printf`, keeping library logging controls
in effect. The author’s unmodified constant-off source remains a separate
compiled control. The core implementation is maintained by the HiGHS team;
this artifact is an independent, tested suggestion for the requested option.

## Full-instance checks and attribution

- The original master has **98,911 rows, 51,291 columns and 19,740 binaries**.
- `probe.cpp` uses the parsed original matrix and returned primal values to
  independently accumulate every row, column bound, integer violation and
  objective in `long double`. Acceptance uses native MIP feasibility tolerance.
- Dual bounds and gap are the native solver’s reports. The independent checks
  validate the primal witness; the table labels those two evidence sources.
- Recorded host: Debian Linux x86-64, AMD EPYC, Clang 17.0.6, CMake 3.31.6,
  static Release, two solver threads. Loading is timed separately; RSS is
  the complete probe process peak. [All native records](observed-results.json)
  and [logs](results/) accompany the phase table.
- The scope is this one uploaded master, this revision and the recorded host.
  Lynth-KR’s outer-approximation application remains their own separate system.
- HiGHS source: `725b40f68247d0e2a00fa4f29d6ca6bde01bd151`.
- Model: [original author attachment](https://github.com/user-attachments/files/35178654/master.mps.gz).
  The model is downloaded from its author at replay time; this folder publishes
  our code and derived results.

Lynth-KR supplied the model, critical-path diagnosis and constant-off finding.
The candidate bool and independent native verification are this review’s
contribution. HiGHS and the source-derived patch carry the included HiGHS MIT
notice; the replay and probe are MIT-licensed.
