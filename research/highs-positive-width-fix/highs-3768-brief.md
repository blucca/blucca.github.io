# HiGHS run comparison

Generated locally with SolveTrail. Facts below are taken from solver logs; full model/witness validation belongs to the application acceptance.

## Comparison context
- Model relationship: Same input model (owner declaration)
- Hardware/resource budget: same, declared by owner
- Intended change and notes: Recorded engineering-study handoff for HiGHS issue 3768. Same original 13-row/364-column MPS and fixed-zero integer; source base 725b40f, Clang 17 Release, one solver thread and 60s limit. A is the instrumented stock CLI; B is the single shared checkColBounds candidate through a C++ public-API probe. Drivers and diagnostic logging differ; rounded native timings are not a speedup benchmark. Keep positive-width intervals live instead of fixing each independently to lower. The complete original-input primal and rational optimum checks are separate: exact optimum 127.1998728. The declared tiny LP remains Infeasible in both builds. Source and complete checks: https://github.com/blucca/blucca.github.io/tree/main/research/highs-positive-width-fix

## Run A
- HiGHS build: 1.16.0 / 725b40f
- Reported final status: Infeasible
- Reported solver time: 0 s
- Last progress sample: 0 s
- Reported primal / dual: inf / -inf
- Reported final gap / tolerance: Not logged / Not logged
- Input rows / columns / nonzeros: 13 / 364 / 786
- Logged threads: 1
- presolve: 0 s (source line 80)
- solve: 0 s (source line 81)
- postsolve: 0 s (source line 82)

### Source-backed observations
- Final solver report: The final report says Infeasible. Logged solver time 0 s. (line 73)
- Largest reported phase: presolve: 0 s. Thread and sub-MIP profiling is kept outside this phase split. (line 80)

## Run B
- HiGHS build: 1.16.0 / 725b40f
- Reported final status: Optimal
- Reported solver time: 0.01 s
- Last progress sample: 0 s
- Reported primal / dual: 127.1998728 / 127.1998728
- Reported final gap / tolerance: 0% / 0.01%
- Input rows / columns / nonzeros: Not logged / Not logged / Not logged
- Logged threads: 1
- presolve: 0 s (source line 48)
- solve: 0.01 s (source line 49)
- postsolve: 0 s (source line 50)

### Source-backed observations
- Final solver report: The final report says Optimal. Reported gap 0% at tolerance 0.01%. Logged solver time 0.01 s. (line 40)
- First recorded feasible value: 127.1999976 appears at 0 s. This is a sampled log time. (line 34)
- Latest recorded dual bound change: The progress table last changes this value at 0 s. The final report is displayed separately, at its printed precision. (line 36)
- Latest recorded feasible value change: The progress table last changes this value at 0 s. The final report is displayed separately, at its printed precision. (line 35)
- Largest reported phase: solve: 0.01 s / 100% of the reported total. Thread and sub-MIP profiling is kept outside this phase split. (line 49)

## This pair
- Reported primal values: A inf; B 127.1998728.
- Reported status changes from Infeasible to Optimal.
- Reported solver times: A 0 s; B 0.01 s.
- For a relative timing comparison, confirm the model relationship and shared hardware/resource budget, with two positive final timings.

## Next controlled run
Replay the unchanged original MPS with the pinned source candidate and retain the complete primal/result. Check all original rows, bounds, the fixed integer and objective with the source-specific checker and rational certificate. Expected exact optimum: 127.1998728. The unchanged tiny LP counterexample remains recorded separately in the study.

## Engineering goal
Restore the original default MIP result while retaining the model and fixed integer. The study already includes full primal/optimality checks and 744 existing presolve assertions. Record the receiving operator’s own build and replay separately.

This brief omits raw logs, file names and model paths. Review your own notes before sharing.
Tool: https://blucca.github.io/solve-trail/