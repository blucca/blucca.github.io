# HiGHS parser notes

`parser.js` is an independent classic script and CommonJS module. Parsing is local and has no dependencies, network requests, solver calls or model loading.

```html
<script src="parser.js"></script>
<script>
  const runs = SolveTrailParser.parse(originalLogText, 'Run A');
</script>
```

```js
const { parse } = require('./parser.js');
const runs = parse(originalLogText, 'Run A');
```

`parse(text, label = 'Log')` returns detected runs in source order, or `[]` for unrecognized text. IDs are `run-1`, `run-2`, … within that input. Each run retains the supplied label. Every exposed property is JSON-serializable.

## Evidence and units

- `lines[].number`, `startLine`, `endLine`, progress `line`, summary `*Line` and event/warning `line` refer to the **original input, 1-based**. CRLF and LF both preserve those offsets. Raw line text is retained without its newline.
- `progress[].time` and native summary/phase times are seconds. `explored`, `gap` and `tolerance` use **printed percentage points**: `0.0087%` is `0.0087`.
- A missing numeric field is `null`. Infinite bounds and `Large`/infinite gaps are also `null`; the exact printed spelling remains in `boundText`, `incumbentText`, `gapText`, or the summary's `primalText`/`dualText`/`gapText`. The printed `-0` is retained as text, including after JSON serialization.
- Progress rows preserve their own rounding. The native final `Solving report` controls status, primal/dual, gap, tolerance, total time, phase time, nodes and LP iterations. `Optimal` can retain a nonzero reported gap.
- `complete` means a native final status was printed. A recognized final status can be complete with a missing time. In a cut-off log, progress remains available while final status/time/gap stay `null`; the caller can show the last observed time separately.
- LP `Model status`, `Objective value` and `HiGHS run time` are valid final facts with no MIP progress. Internal label spacing may be padded, as in `Model   status      : Optimal`. A missing LP dual or gap stays `null`, including on `Optimal`.
- Objective direction is read from an explicit `Objective sense` line. A model named `MaximizeEmpireValue-pulp` remains a name; its optimization direction is not encoded by the name.

## Supported actual formats

- HiGHS 1.16.0: `MIP : name`, separate Rows/Cols/Nonzeros/Integer labels, scheduler/thread-count lines, presolve reductions, standard twelve-column MIP progress plus optional Src, final solving reports and native phase times.
- HiGHS 1.7.2: the one-line `MIP name has … rows; … cols; … nonzeros; … integer variables` header, the same progress columns without a Src header, no-incumbent `-inf`, signed zero, `Large` gap, and native restart notices.
- Counts accept the printed `k` suffix. Bounds accept signed scientific notation and `inf`/`Infinity`; nonfinite values retain their printed token.
- `MIP-Timing: 5.2 - …` and `MIP-Timing: After 0.0497s - …` become source-linked phase events. Untimed restart/warning lines retain `time:null`, rather than acquiring an invented crossing time.

The per-thread/sub-MIP profiling table is retained as raw evidence. Its nested times are separate from the final report's total and three top-level phase times. In particular, profiling's “number of threads used” does not replace the scheduler's configured thread count.

## Appended runs and boundaries

Each `Running HiGHS` banner starts a new run. After a final status, a genuine new MIP/LP model header (or `Solving MIP model with:`) also starts a run; this handles same-instance append files without another banner. Such a run carries the last preceding printed HiGHS version/hash. Its absent numeric fields still start at `null`.

`MIP-Timing`, `MIP time [calls]`, per-thread `TOTAL`, sub-MIP profiling, and `Model after restart` are parts of the existing run. A restart's reduced dimensions do not replace that run's initial post-presolve dimensions. A header is the boundary: any preceding loader prelude remains in the previous run's raw lines.

This initial parser covers the standard formats above. Custom/interleaved parallel log wrappers and changed column layouts require their own observed source before extending it. Logged status and progress are solver reports; witness/model validation belongs to a separate task.

## Standalone source checks

From this directory:

```sh
node check-parser.cjs
```

The native golden files are `samples/default.log` and `samples/no-centre.log`, with attribution in `samples/ABOUT.json`. They retain round709's complete HiGHS 1.16.0 solver output and all native numeric values; the absolute model-load path is replaced in one line. The native reported totals are **11.14 / 7.64 seconds**, with presolve/solve **5.09 + 6.04 / 3.67 + 3.97**. Both report primal **59.1841420676**, dual **59.1789918416**, gap **0.0087%**, tolerance **0.01%**, **1 node / 4020 LP iterations**. Their last progress gap is separately printed as **0.01%**.

`samples/cut-off.log` is the actual default-log prefix before the solving report. The checks also concatenate the native logs with/without a second banner, use selected exact lines from [HiGHS discussion 1893, comment 10440378](https://github.com/ERGO-Code/HiGHS/discussions/1893#discussioncomment-10440378), and apply small token/LP-format controls. The discussion author describes a maximize problem in surrounding prose; that detail is not injected into the raw-log parser.

Checks run the JavaScript parser over those existing sources. They do not rerun a solver or install a test framework.
