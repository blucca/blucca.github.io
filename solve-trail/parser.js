/* SolveTrail: HiGHS text logs, parsed locally without a solver or dependencies. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SolveTrailParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  var NONFINITE = /^(?:[+-]?inf(?:inity)?|nan|large)$/i;
  var COUNT = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?k?$/i;

  function number(token) {
    if (token == null) return null;
    var text = String(token).trim();
    if (!NUMBER.test(text)) return null;
    var value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function count(token) {
    if (token == null || !COUNT.test(token)) return null;
    var value = number(String(token).replace(/k$/i, ''));
    if (value === null) return null;
    value *= /k$/i.test(token) ? 1000 : 1;
    return Number.isFinite(value) ? value : null;
  }

  function percent(token) {
    return number(String(token).replace(/%$/, ''));
  }

  function isBound(token) {
    return NUMBER.test(token) || NONFINITE.test(token);
  }

  function modelHeader(text) {
    var match = /^(MIP|LP)\s*:\s*(.*)$/i.exec(text);
    if (match) return { type: match[1].toUpperCase(), name: match[2].trim() || null };
    match = /^(MIP|LP)\s+(.+?)\s+has\s+(\S+)\s+rows;\s+(\S+)\s+cols;\s+(\S+)\s+nonzeros(?:;\s+(\S+)\s+integer variables)?\s*$/i.exec(text);
    if (match && count(match[3]) !== null && count(match[4]) !== null && count(match[5]) !== null) {
      return {
        type: match[1].toUpperCase(), name: match[2].trim(),
        rows: count(match[3]), cols: count(match[4]), nonzeros: count(match[5]),
        integer: match[6] ? count(match[6]) : null
      };
    }
    return null;
  }

  function banner(text) {
    return /^Running HiGHS\s+(\S+)(?:\s+\(git hash:\s*([^)]*)\))?/i.exec(text);
  }

  function newRun(index, label, line, version, hash) {
    return {
      id: 'run-' + (index + 1), label: label, version: version, hash: hash,
      modelType: null, modelName: null, objectiveSense: null,
      input: { rows: null, cols: null, nonzeros: null, integer: null },
      presolved: { rows: null, cols: null, nonzeros: null },
      threads: null, startLine: line, endLine: line, lines: [], progress: [],
      summary: {
        status: null, statusLine: null, solutionStatus: null,
        primal: null, primalText: null, primalLine: null,
        dual: null, dualText: null, dualLine: null,
        gap: null, gapText: null, gapLine: null, tolerance: null,
        totalTime: null, totalTimeLine: null,
        phases: { presolve: null, solve: null, postsolve: null },
        nodes: null, lpIterations: null
      },
      events: [], warnings: [], complete: false
    };
  }

  function progressRow(text, line) {
    var tokens = text.split(/\s+/);
    var source = null;
    if (tokens.length === 13 && /^[A-Za-z*]$/.test(tokens[0])) source = tokens.shift();
    if (tokens.length !== 12 || !/^\S+s$/.test(tokens[11]) || !/%$/.test(tokens[3])) return null;
    var counts = [0, 1, 2, 7, 8, 9, 10].map(function (index) { return count(tokens[index]); });
    var time = number(tokens[11].slice(0, -1));
    var explored = percent(tokens[3]);
    if (time === null || explored === null || counts.some(function (value) { return value === null; })) return null;
    if (!isBound(tokens[4]) || !isBound(tokens[5])) return null;
    if (!(NONFINITE.test(tokens[6]) || /%$/.test(tokens[6]) && percent(tokens[6]) !== null)) return null;
    return {
      line: line, time: time, source: source,
      nodes: counts[0], queue: counts[1], leaves: counts[2], explored: explored,
      bound: number(tokens[4]), boundText: tokens[4],
      incumbent: number(tokens[5]), incumbentText: tokens[5],
      gap: percent(tokens[6]), gapText: tokens[6],
      cuts: counts[3], inLp: counts[4], conflicts: counts[5], lpIterations: counts[6]
    };
  }

  function parse(text, label) {
    if (typeof text !== 'string' || !text.trim()) return [];
    label = label == null ? 'Log' : String(label);
    var sourceLines = text.split(/\r\n|\n|\r/);
    var runs = [];
    var run = null;
    var context = null;
    var version = null;
    var hash = null;

    function start(line) {
      run = newRun(runs.length, label, line, version, hash);
      runs.push(run);
      context = { report: false, dimensions: 'input' };
    }

    sourceLines.forEach(function (raw, index) {
      var line = index + 1;
      var clean = raw.trim();
      var heading = modelHeader(clean);
      var running = banner(clean);
      var solving = /^Solving MIP model with:\s*$/i.test(clean);
      var lpStatus = /^Model\s+status\s*(?::|\s{2,})\s*(\S.*)$/i.exec(clean);
      var report = /^Solving report\s*$/i.test(clean);
      var table = /\bBestBound\s+BestSol\s+Gap\b.*\bLpIters\s+Time\b/.test(clean);

      if (running) {
        version = running[1];
        hash = running[2] ? running[2].trim() || null : null;
        start(line);
      } else if (run && run.complete && (heading || solving)) {
        start(line);
      } else if (!run && (heading || solving || report || lpStatus || table)) {
        start(line);
      }
      if (!run) return;

      run.lines.push({ number: line, text: raw });
      run.endLine = line;
      var summary = run.summary;
      var match;

      if (heading) {
        run.modelType = heading.type;
        run.modelName = heading.name;
        context.dimensions = 'input';
        if ('rows' in heading) {
          run.input.rows = heading.rows;
          run.input.cols = heading.cols;
          run.input.nonzeros = heading.nonzeros;
          run.input.integer = heading.integer;
        }
      }
      match = /^(Rows|Cols|Columns|Nonzeros|Integer)\s*:\s*(\S+)/i.exec(clean);
      if (match && context.dimensions === 'input' && !context.report) {
        var field = { rows: 'rows', cols: 'cols', columns: 'cols', nonzeros: 'nonzeros', integer: 'integer' }[match[1].toLowerCase()];
        run.input[field] = count(match[2]);
      }
      match = /^Objective sense\s*:\s*(minimize|maximize|minimization|maximization)\s*$/i.exec(clean);
      if (match) run.objectiveSense = /^min/i.test(match[1]) ? 'minimize' : 'maximize';
      match = /^Scheduler initialized:\s*(\S+)\s+threads\b/i.exec(clean);
      if (!match) match = /^Thread count:.*\bacross\s+(\S+)\s+threads\b/i.exec(clean);
      if (!match) match = /^Thread count:\s*(\S+)(?:\s+threads)?\s*$/i.exec(clean);
      if (match) run.threads = count(match[1]);

      if (/^Presolving model\s*$/i.test(clean)) {
        context.dimensions = 'presolved';
        run.events.push({ line: line, time: null, label: clean, kind: 'phase' });
      }
      if (solving) {
        run.modelType = run.modelType || 'MIP';
        context.dimensions = 'presolved';
        run.events.push({ line: line, time: null, label: clean, kind: 'phase' });
      }
      if (!context.report && context.dimensions === 'presolved') {
        match = /^(\S+)\s+rows,\s+(\S+)\s+cols,\s+(\S+)\s+nonzeros(?:\s|$)/i.exec(clean);
        if (!match) match = /^Presolve reductions:\s*rows\s+(\d+)(?:\([^)]*\))?;\s*(?:columns|cols)\s+(\d+)(?:\([^)]*\))?;\s*nonzeros\s+(\d+)/i.exec(clean);
        if (match) {
          run.presolved.rows = count(match[1]);
          run.presolved.cols = count(match[2]);
          run.presolved.nonzeros = count(match[3]);
        } else {
          match = /^(\S+)\s+(rows|cols|nonzeros)(?:\s|$)/i.exec(clean);
          if (match && count(match[1]) !== null) run.presolved[match[2].toLowerCase()] = count(match[1]);
        }
      }

      var row = progressRow(clean, line);
      if (row && !context.report) run.progress.push(row);

      match = /^MIP-Timing:\s*(?:After\s+)?(\S+?)s?\s*-\s*(.+)$/i.exec(clean);
      if (match) {
        run.events.push({ line: line, time: number(match[1]), label: match[2].trim(), kind: 'phase' });
      } else if (/^(?:Restarting search from the root node|\d+(?:\.\d+)?%.*inactive.*restarting)\b/i.test(clean)) {
        run.events.push({ line: line, time: null, label: clean, kind: 'restart' });
      } else if (/^(?:WARNING|ERROR)\s*:/i.test(clean) || /^Highs\w*::.*\bError\b/.test(clean)) {
        run.warnings.push({ line: line, text: raw });
        run.events.push({ line: line, time: null, label: clean, kind: 'warning' });
      }

      if (report) {
        context.report = true;
        run.modelType = run.modelType || 'MIP';
      }
      if (table) run.modelType = run.modelType || 'MIP';
      if (lpStatus) {
        summary.status = lpStatus[1].trim();
        summary.statusLine = line;
        run.modelType = run.modelType || 'LP';
      }
      match = /^Objective\s+value\s*(?::|\s{2,})\s*(\S+)/i.exec(clean);
      if (match) {
        summary.primalText = match[1];
        summary.primal = number(match[1]);
        summary.primalLine = line;
      }
      match = /^HiGHS\s+run\s+time\s*(?::|\s{2,})\s*(\S+)/i.exec(clean);
      if (match) {
        summary.totalTime = number(match[1].replace(/s$/, ''));
        summary.totalTimeLine = line;
      }

      if (context.report) {
        match = /^Status\s*:?[ \t]+(\S.*)$/i.exec(clean);
        if (match) { summary.status = match[1].trim(); summary.statusLine = line; }
        match = /^Model\s*:?[ \t]+(\S.*)$/i.exec(clean);
        if (match) run.modelName = run.modelName || match[1].trim();
        match = /^Solution status\s*:?[ \t]+(\S.*)$/i.exec(clean);
        if (match) summary.solutionStatus = match[1].trim();
        match = /^(Primal bound|Dual bound)\s*:?[ \t]+(\S+)/i.exec(clean);
        if (match) {
          var which = /^Primal/i.test(match[1]) ? 'primal' : 'dual';
          summary[which] = number(match[2]);
          summary[which + 'Text'] = match[2];
          summary[which + 'Line'] = line;
        }
        match = /^Gap\s*:?[ \t]+(\S+)(?:\s+\(tolerance:\s*([^\s)]+)\))?/i.exec(clean);
        if (match) {
          summary.gap = percent(match[1]);
          summary.gapText = match[1];
          summary.gapLine = line;
          summary.tolerance = match[2] ? percent(match[2]) : null;
        }
        match = /^Timing\s*:?[ \t]+(\S+)/i.exec(clean);
        if (match) { summary.totalTime = number(match[1]); summary.totalTimeLine = line; }
        match = /^(\S+)\s+\((Presolve|Solve|Postsolve)\)\s*$/i.exec(clean);
        if (match) {
          var seconds = number(match[1]);
          summary.phases[match[2].toLowerCase()] = seconds === null ? null : { seconds: seconds, line: line };
        }
        match = /^Nodes\s*:?[ \t]+(\S+)/i.exec(clean);
        if (match) summary.nodes = count(match[1]);
        match = /^LP iterations\s*:?[ \t]+(\S+)/i.exec(clean);
        if (match) summary.lpIterations = count(match[1]);
      }
      run.complete = summary.status !== null;
    });
    return runs;
  }

  return { parse: parse };
});
