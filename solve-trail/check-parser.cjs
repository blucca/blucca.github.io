'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('./parser.js');
const sample = name => fs.readFileSync(path.join(__dirname, 'samples', name), 'utf8');
const defaultLog = sample('default.log');
const noCentreLog = sample('no-centre.log');
const cutOffLog = sample('cut-off.log');
let checks = 0;

function check(label, test) {
  test();
  checks += 1;
  process.stdout.write('PASS ' + label + '\n');
}

function one(text, label) {
  const runs = parse(text, label);
  assert.equal(runs.length, 1);
  return runs[0];
}

function originalLine(text, line) {
  return text.split(/\r\n|\n|\r/)[line - 1];
}

function golden(text, duration, presolve, solve) {
  const run = one(text, 'Native sample');
  assert.equal(run.label, 'Native sample');
  assert.equal(run.version, '1.16.0');
  assert.equal(run.hash, '725b40f');
  assert.equal(run.modelType, 'MIP');
  assert.equal(run.modelName, 'master');
  assert.equal(run.objectiveSense, null);
  assert.deepEqual(run.input, { rows: 98911, cols: 51291, nonzeros: 224253, integer: 19740 });
  assert.deepEqual(run.presolved, { rows: 98159, cols: 50912, nonzeros: 222770 });
  assert.equal(run.threads, 2); // A profiling thread count is not the configured count.
  assert.equal(run.complete, true);
  assert.equal(run.summary.status, 'Optimal');
  assert.equal(run.summary.solutionStatus, 'feasible');
  assert.equal(run.summary.totalTime, duration);
  assert.equal(run.summary.phases.presolve.seconds, presolve);
  assert.equal(run.summary.phases.solve.seconds, solve);
  assert.equal(run.summary.phases.postsolve.seconds, 0);
  assert.equal(run.summary.primal, 59.1841420676);
  assert.equal(run.summary.dual, 59.1789918416);
  assert.equal(run.summary.primalText, '59.1841420676');
  assert.equal(run.summary.dualText, '59.1789918416');
  assert.equal(run.summary.gap, 0.0087);
  assert.equal(run.summary.gapText, '0.0087%');
  assert.equal(run.summary.tolerance, 0.01);
  assert.equal(run.summary.nodes, 1);
  assert.equal(run.summary.lpIterations, 4020);
  assert.equal(run.progress.length, 4);
  assert.equal(run.progress[0].source, 'J');
  assert.equal(run.progress[0].bound, null);
  assert.equal(run.progress[0].boundText, '-inf');
  assert.equal(run.progress[0].gap, null);
  assert.equal(run.progress[0].gapText, 'Large');
  assert.equal(run.progress.at(-1).gap, 0.01); // Native row rounding stays independent.
  assert.equal(run.progress.at(-1).source, null);
  assert.match(originalLine(text, run.summary.statusLine), /Status\s+Optimal/);
  assert.match(originalLine(text, run.summary.totalTimeLine), /Timing\s+/);
  assert.match(originalLine(text, run.summary.primalLine), /Primal bound/);
  assert.match(originalLine(text, run.summary.dualLine), /Dual bound/);
  assert.match(originalLine(text, run.summary.gapLine), /0\.0087%/);
  for (const phase of Object.values(run.summary.phases)) assert.match(originalLine(text, phase.line), /\((?:Pre|Post)?solve\)/i);
  for (const point of run.progress) assert.equal(run.lines.find(line => line.number === point.line).text, originalLine(text, point.line));
  return run;
}

check('native default: exact final report, rounded progress, raw source lines', () => golden(defaultLog, 11.14, 5.09, 6.04));
check('native no-centre: exact phases; nested profiling remains separate', () => golden(noCentreLog, 7.64, 3.67, 3.97));

check('actual cut-off: last observed progress, no synthesized completion', () => {
  const run = one(cutOffLog);
  assert.equal(run.complete, false);
  assert.equal(run.progress.length, 4);
  assert.equal(run.progress.at(-1).time, 11.1);
  assert.equal(run.progress.at(-1).gapText, '0.01%');
  assert.equal(run.summary.status, null);
  assert.equal(run.summary.totalTime, null);
  assert.equal(run.summary.gap, null);
  assert.equal(run.summary.nodes, null);
  assert.deepEqual(run.summary.phases, { presolve: null, solve: null, postsolve: null });
});

check('two banners: both runs retained with original 1-based offsets', () => {
  const joined = defaultLog + '\n' + noCentreLog;
  const runs = parse(joined, 'Appended');
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(run => run.id), ['run-1', 'run-2']);
  assert.deepEqual(runs.map(run => run.summary.totalTime), [11.14, 7.64]);
  assert.equal(runs[1].startLine, defaultLog.split(/\r\n|\n|\r/).length + 1);
  assert.equal(runs[0].endLine, runs[1].startLine - 1);
  assert.match(originalLine(joined, runs[1].summary.statusLine), /Status\s+Optimal/);
  assert.match(originalLine(joined, runs[1].progress[0].line), /3\.7s$/);
});

check('same-instance append: genuine model header splits after final report', () => {
  const lines = noCentreLog.split(/\r\n|\n|\r/);
  const header = lines.findIndex(line => /^MIP\s*:/.test(line));
  assert.ok(header > 0);
  const joined = defaultLog + '\n' + lines.slice(header).join('\n');
  const runs = parse(joined);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(run => run.summary.totalTime), [11.14, 7.64]);
  assert.equal(runs[1].version, '1.16.0');
  assert.match(originalLine(joined, runs[1].startLine), /^MIP\s*:/);
  assert.equal(runs[0].endLine, runs[1].startLine - 1);
  assert.equal(runs[1].threads, 2);
});

// Exact selected lines from HiGHS discussion 1893, comment 10440378.
// The author describes a maximize problem in prose; the log prints a model name.
const legacy = `Running HiGHS 1.7.2 (git hash: 5ce7a2753): Copyright (c) 2024 HiGHS under MIT licence terms
MIP  MaximizeEmpireValue-pulp has 34791 rows; 33419 cols; 95705 nonzeros; 33417 integer variables
Presolving model
8822 rows, 12833 cols, 52994 nonzeros  0s
Solving MIP model with:
   8822 rows
   12833 cols (3411 binary, 9421 integer, 1 implied int., 0 continuous)
   52994 nonzeros
     Proc. InQueue |  Leaves   Expl. | BestBound       BestSol              Gap |   Cuts   InLp Confl. | LpIters     Time
         0       0         0   0.00%   9354143398.563  -inf                 inf        0      0      0         0     0.6s
 R       0       0         0   0.00%   9354143398.563  -0                 Large        0      0      0         0     0.8s
0.1% inactive integer columns, restarting
Model after restart has 8821 rows, 12822 cols (3401 bin., 9420 int., 1 impl., 0 cont.), and 52678 nonzeros
 L     426     397        14   0.00%   432751535.1159  346898468.9372    24.75%     6878   1844     90    427948   218.8s`;

check('native 1.7.x: no incumbent, signed zero, Large gap, restart', () => {
  const run = one(legacy.replace(/\n/g, '\r\n'));
  assert.equal(run.version, '1.7.2');
  assert.equal(run.modelName, 'MaximizeEmpireValue-pulp');
  assert.equal(run.objectiveSense, null);
  assert.deepEqual(run.input, { rows: 34791, cols: 33419, nonzeros: 95705, integer: 33417 });
  assert.deepEqual(run.presolved, { rows: 8822, cols: 12833, nonzeros: 52994 });
  assert.equal(run.progress.length, 3);
  assert.equal(run.progress[0].incumbent, null);
  assert.equal(run.progress[0].incumbentText, '-inf');
  assert.equal(run.progress[0].gapText, 'inf');
  assert.equal(run.progress[0].gap, null);
  assert.equal(Object.is(run.progress[1].incumbent, -0), true);
  assert.equal(run.progress[1].incumbentText, '-0');
  assert.equal(run.progress.at(-1).bound, 432751535.1159);
  assert.equal(run.progress.at(-1).incumbent, 346898468.9372);
  assert.equal(run.progress.at(-1).gap, 24.75);
  assert.equal(run.events.filter(event => event.kind === 'restart').length, 1);
  assert.equal(run.events.find(event => event.kind === 'restart').time, null);
  assert.equal(run.complete, false);
});

check('printed token control: k counts and nonfinite bounds stay serializable', () => {
  const run = one(`Running HiGHS 1.7.2 (git hash: control)
MIP : token control
 X 1.2k 2k 3k 0.00% -Infinity Infinity inf 4k 5k 6k 7.5k 1.2s
Solving report
  Status            Time limit reached
  Primal bound      inf
  Dual bound        -inf
  Gap               Large (tolerance: 0.01%)`);
  const point = run.progress[0];
  assert.deepEqual([point.nodes, point.queue, point.leaves, point.cuts, point.inLp, point.conflicts, point.lpIterations], [1200, 2000, 3000, 4000, 5000, 6000, 7500]);
  assert.equal(point.bound, null);
  assert.equal(point.boundText, '-Infinity');
  assert.equal(point.incumbent, null);
  assert.equal(point.incumbentText, 'Infinity');
  assert.equal(run.summary.primal, null);
  assert.equal(run.summary.primalText, 'inf');
  assert.equal(run.summary.dualText, '-inf');
  assert.equal(run.summary.gapText, 'Large');
  assert.equal(run.summary.totalTime, null);
  assert.equal(run.complete, true);
  assert.equal(JSON.parse(JSON.stringify(run)).progress[0].bound, null);
});

check('short LP: final status/objective/time, plus terminal status without time', () => {
  const text = 'LP : small LP\nObjective sense : Maximize\nModel status : Optimal\nObjective value : -1.200000e+01\nHiGHS run time : 0.42';
  const run = one(text);
  assert.equal(run.modelType, 'LP');
  assert.equal(run.objectiveSense, 'maximize');
  assert.equal(run.summary.status, 'Optimal');
  assert.equal(run.summary.primal, -12);
  assert.equal(run.summary.primalText, '-1.200000e+01');
  assert.equal(run.summary.totalTime, 0.42);
  assert.equal(run.summary.statusLine, 3);
  assert.equal(run.progress.length, 0);
  assert.equal(run.summary.dual, null);
  assert.equal(run.summary.gap, null);
  assert.equal(run.complete, true);
  const missingTime = one('Model status : Infeasible');
  assert.equal(missingTime.complete, true);
  assert.equal(missingTime.summary.totalTime, null);
  const padded = one('Model   status      : Optimal\nObjective   value   : -1.200000e+01\nHiGHS   run   time  : 0.42');
  assert.deepEqual([padded.summary.status, padded.summary.primal, padded.summary.totalTime, padded.complete], ['Optimal', -12, 0.42, true]);
});

check('classic browser API / CJS parity and unrecognized input', () => {
  assert.deepEqual(parse('This is not a solver log.\n11.14 seconds'), []);
  assert.deepEqual(parse(''), []);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'parser.js'), 'utf8'), context);
  assert.equal(typeof context.SolveTrailParser.parse, 'function');
  const browser = context.SolveTrailParser.parse(defaultLog, 'Browser');
  const node = parse(defaultLog, 'Browser');
  assert.equal(JSON.stringify(browser), JSON.stringify(node));
  const inspect = value => {
    if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
    if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  };
  [defaultLog, noCentreLog, cutOffLog, legacy].forEach(text => inspect(parse(text)));
});

process.stdout.write(`\n${checks} checks passed. No solver run or dependency installation.\n`);
