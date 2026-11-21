(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const colors = { A: "#147e9a", B: "#bd642c" };
  const slots = { A: { text: "", label: "Run A", runs: [], index: 0 }, B: { text: "", label: "Run B", runs: [], index: 0 } };
  const state = { example: false, source: { slot: "A", line: 1 }, hover: null };
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const fmt = (value, digits = 4) => finite(value) ? new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value) : "Not logged";
  const seconds = (value) => finite(value) ? fmt(value, 3) + " s" : "Not logged";
  const percent = (value) => finite(value) ? fmt(value, 5) + "%" : "Not logged";
  const current = (key) => slots[key].runs[slots[key].index] || null;
  const context = () => ({ relationship: byId("relationship").value, hardware: byId("hardware").checked, notes: byId("notes").value });

  function resetComparisonContext() {
    byId("relationship").value = "unspecified";
    byId("hardware").checked = false;
    byId("notes").value = "";
    state.example = false;
  }

  function el(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function message(text) { byId("status").textContent = text; }

  function sourceLink(key, line, text) {
    const button = el("button", "source-link", text || ("Run " + key + ", line " + line));
    button.type = "button";
    button.addEventListener("click", () => showSource(key, line, true));
    return button;
  }

  function duration(run) {
    if (!run) return null;
    if (finite(run.summary.totalTime)) return run.summary.totalTime;
    return run.progress.length ? run.progress[run.progress.length - 1].time : null;
  }

  function facts(run) {
    const observations = [];
    if (!run) return observations;
    const summary = run.summary;
    if (summary.status) {
      let detail = "The final report says " + summary.status + ".";
      if (finite(summary.gap)) detail += " Reported gap " + percent(summary.gap) + (finite(summary.tolerance) ? " at tolerance " + percent(summary.tolerance) : "") + ".";
      if (finite(summary.totalTime)) detail += " Logged solver time " + seconds(summary.totalTime) + ".";
      observations.push({ title: "Final solver report", detail, line: summary.statusLine });
    } else {
      observations.push({
        title: "No final report in this log",
        detail: finite(duration(run)) ? "The last progress sample is at " + seconds(duration(run)) + ". Final status, gap and phase totals need a completed report." : "A HiGHS run was detected. Capture solver output through its final report to see termination and timings.",
        line: run.progress.length ? run.progress[run.progress.length - 1].line : run.startLine
      });
    }
    const incumbent = run.progress.find((point) => finite(point.incumbent));
    if (incumbent) observations.push({
      title: "First recorded feasible value",
      detail: fmt(incumbent.incumbent, 8) + " appears at " + seconds(incumbent.time) + ". This is a sampled log time.",
      line: incumbent.line
    });
    for (const [field, label] of [["bound", "dual bound"], ["incumbent", "feasible value"]]) {
      let prior = null, changed = null, samples = 0;
      for (const point of run.progress) {
        if (!finite(point[field])) continue;
        samples += 1;
        if (prior === null || point[field] !== prior) changed = point;
        prior = point[field];
      }
      if (samples > 1 && changed) observations.push({
        title: "Latest recorded " + label + " change",
        detail: "The progress table last changes this value at " + seconds(changed.time) + ". The final report is displayed separately, at its printed precision.",
        line: changed.line
      });
    }
    const phaseEntries = Object.entries(summary.phases).filter((entry) => entry[1] && finite(entry[1].seconds));
    if (phaseEntries.length) {
      const largest = phaseEntries.reduce((a, b) => a[1].seconds >= b[1].seconds ? a : b);
      observations.push({
        title: "Largest reported phase: " + largest[0],
        detail: seconds(largest[1].seconds) + (finite(summary.totalTime) && summary.totalTime > 0 ? " / " + percent(largest[1].seconds / summary.totalTime * 100) + " of the reported total." : ".") + " Thread and sub-MIP profiling is kept outside this phase split.",
        line: largest[1].line
      });
    }
    const restarts = run.events.filter((event) => event.kind === "restart");
    if (restarts.length) observations.push({
      title: restarts.length + " logged restart" + (restarts.length === 1 ? "" : "s"),
        detail: "Inspect the original restart message alongside the bound curve; the model supplies the cause.",
      line: restarts[0].line
    });
    for (const warning of run.warnings.slice(0, 2)) observations.push({ title: "Solver warning", detail: warning.text, line: warning.line });
    return observations;
  }

  function comparison(a, b, declaration) {
    const result = { lines: [], ratio: null, delta: null, primalDelta: null };
    if (!a || !b) {
      result.lines.push("Open a second log to compare two recorded runs.");
      return result;
    }
    const left = a.summary, right = b.summary;
    if (finite(left.primal) && finite(right.primal)) {
      result.primalDelta = right.primal - left.primal;
      result.lines.push(result.primalDelta === 0
        ? "The final reports print matching primal values."
        : "Reported primal value changes by " + fmt(result.primalDelta, 10) + " (B − A). Check the intended result before accepting the change.");
    } else {
      result.lines.push("Reported primal values: A " + (left.primalText || "not logged") + "; B " + (right.primalText || "not logged") + ".");
    }
    if (left.status !== right.status) result.lines.push("Reported status changes from " + (left.status || "no final report") + " to " + (right.status || "no final report") + ".");
    const changed = ["rows", "cols", "nonzeros"].filter((key) => finite(a.input[key]) && finite(b.input[key]) && a.input[key] !== b.input[key]);
    if (changed.length) result.lines.push("Input dimensions differ: " + changed.join(", ") + ". The model relationship is supplied by you.");
    if (finite(left.totalTime) && finite(right.totalTime)) {
      result.delta = right.totalTime - left.totalTime;
      result.lines.push("Reported solver times: A " + seconds(left.totalTime) + "; B " + seconds(right.totalTime) + ".");
      if (a.complete && b.complete && left.totalTime > 0 && right.totalTime > 0 && declaration.hardware && ["same", "reformulation"].includes(declaration.relationship)) {
        result.ratio = right.totalTime / left.totalTime;
        const change = (result.ratio - 1) * 100;
        result.lines.push("In this pair, B uses " + fmt(Math.abs(change), 1) + "% " + (change <= 0 ? "less" : "more") + " logged solver time. Your model relationship and hardware declaration define the comparison.");
      } else {
        result.lines.push("For a relative timing comparison, confirm the model relationship and shared hardware/resource budget, with two positive final timings.");
      }
    } else {
      result.lines.push("A complete final timing is needed for each side. Last progress samples remain visible on the plot.");
    }
    return result;
  }

  function renderSummary(key) {
    const box = byId("runSummary" + key), run = current(key);
    box.replaceChildren();
    if (!run) {
      box.append(el("h2", "run-heading", "Run " + key), el("p", "run-version", "Open a HiGHS text log."));
      return;
    }
    box.append(el("h2", "run-heading", slots[key].label));
    const version = "HiGHS " + (run.version || "version not logged") + (run.hash ? " / " + run.hash : "");
    box.append(el("p", "run-version", version));
    box.append(el("p", "run-status", run.summary.status ? "Reported " + run.summary.status : "No final report"));
    box.append(el("p", "run-duration", seconds(duration(run)) + (finite(run.summary.totalTime) ? " logged solver time" : " last observed")));
    const printedResult = el("p", "run-result");
    printedResult.append(
      el("span", "result-gap", "Gap " + (finite(run.summary.gap) ? percent(run.summary.gap) : run.summary.gapText || "not logged")),
      el("span", "result-primal", "Primal " + (run.summary.primalText || "not logged"))
    );
    box.append(printedResult);
    const rows = [
      ["Final gap", finite(run.summary.gap) ? percent(run.summary.gap) : "Not logged"],
      ["Primal value", run.summary.primalText || "Not logged"],
      ["Dual bound", run.summary.dualText || "Not logged"],
      ["Input size", finite(run.input.rows) && finite(run.input.cols) ? fmt(run.input.rows, 0) + " rows / " + fmt(run.input.cols, 0) + " cols" : "Not logged"],
      ["Threads", finite(run.threads) ? fmt(run.threads, 0) : "Not logged"],
      ["Final nodes", finite(run.summary.nodes) ? fmt(run.summary.nodes, 0) : "Not logged"],
      ["LP iterations", finite(run.summary.lpIterations) ? fmt(run.summary.lpIterations, 0) : "Not logged"],
      ["Gap tolerance", finite(run.summary.tolerance) ? percent(run.summary.tolerance) : "Not logged"]
    ];
    const list = el("dl", "stats");
    for (const [label, value] of rows) {
      const row = el("div");
      row.append(el("dt", "", label), el("dd", "", value));
      list.append(row);
    }
    const details = el("details", "summary-facts");
    details.append(el("summary", "", "Run details"), list);
    box.append(details);
  }

  function renderFindings() {
    const box = byId("findings");
    box.replaceChildren();
    for (const key of ["A", "B"]) {
      const run = current(key);
      if (!run) continue;
      const column = el("div", "finding-column");
      column.append(el("h2", "", "Run " + key + " observations"));
      for (const fact of facts(run)) {
        const item = el("article", "finding");
        item.append(el("h3", "", fact.title), el("p", "", fact.detail));
        if (fact.line) item.append(sourceLink(key, fact.line));
        column.append(item);
      }
      box.append(column);
    }
  }

  function renderPhases() {
    const box = byId("phaseComparison");
    box.replaceChildren();
    const a = current("A"), b = current("B");
    const available = [a, b].some((run) => run && Object.values(run.summary.phases).some(Boolean));
    if (!available) {
      box.append(el("p", "empty", "Final phase totals are not logged here. Explicit timing messages remain in the source."));
      return;
    }
    const table = el("table", "phase-table");
    const head = el("tr");
    for (const title of ["Reported phase", "Run A", "Run B", "B − A"]) head.append(el("th", "", title));
    const thead = el("thead"); thead.append(head); table.append(thead);
    const tbody = el("tbody");
    for (const name of ["presolve", "solve", "postsolve"]) {
      const left = a && a.summary.phases[name], right = b && b.summary.phases[name];
      if (!left && !right) continue;
      const row = el("tr");
      row.append(el("th", "", name.charAt(0).toUpperCase() + name.slice(1)));
      for (const [key, phase] of [["A", left], ["B", right]]) {
        const cell = el("td");
        if (phase) cell.append(sourceLink(key, phase.line, seconds(phase.seconds)));
        else cell.textContent = "Not logged";
        row.append(cell);
      }
      row.append(el("td", "", left && right ? seconds(right.seconds - left.seconds) : "Not logged"));
      tbody.append(row);
    }
    table.append(tbody); box.append(table);
    box.append(el("p", "phase-note", "These are the final report’s Presolve / Solve / Postsolve times. Small total differences reflect printed rounding; nested thread work is not added."));
  }

  function renderComparison() {
    const box = byId("comparisonResult");
    box.replaceChildren();
    const result = comparison(current("A"), current("B"), context());
    result.lines.forEach((line) => box.append(el("p", "", line)));
  }

  function svgEl(tag, attributes, text) {
    const item = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes || {})) item.setAttribute(key, value);
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function pointsFor(run, metric) {
    if (!run) return [];
    const points = run.progress.map((point) => ({
      time: point.time, gap: point.gap, bound: point.bound, incumbent: point.incumbent,
      gapText: point.gapText, boundText: point.boundText, incumbentText: point.incumbentText,
      line: point.line, lines: { gap: point.line, bound: point.line, incumbent: point.line }, source: "Progress table"
    }));
    const summary = run.summary;
    if (run.complete && finite(summary.totalTime)) {
      points.push({ time: summary.totalTime, gap: summary.gap, bound: summary.dual, incumbent: summary.primal, gapText: summary.gapText, boundText: summary.dualText, incumbentText: summary.primalText, line: metric === "gap" ? summary.gapLine : summary.primalLine, lines: { gap: summary.gapLine, bound: summary.dualLine, incumbent: summary.primalLine }, source: "Final report" });
    }
    return points.filter((point) => finite(point.time)).sort((a, b) => a.time - b.time);
  }

  let plot = { series: {}, maxTime: 1, left: 80, right: 968, top: 24, bottom: 302 };

  function renderPlot() {
    const chart = byId("chart"), metric = byId("plotMetric").value;
    chart.replaceChildren();
    const series = { A: pointsFor(current("A"), metric), B: pointsFor(current("B"), metric) };
    const values = Object.values(series).flatMap((points) => points.flatMap((point) => metric === "gap" ? [point.gap] : [point.bound, point.incumbent])).filter(finite);
    const times = Object.values(series).flatMap((points) => points.map((point) => point.time));
    const phone = window.matchMedia("(max-width: 700px)").matches;
    plot = { series, maxTime: times.reduce((max, time) => Math.max(max, time), Math.max(1, duration(current("A")) || 0, duration(current("B")) || 0)), left: phone ? 125 : 80, right: 968, top: 24, bottom: 302 };
    plot.x = null;
    byId("plotEmpty").hidden = values.length > 0;
    if (!values.length) {
      byId("plotEmpty").textContent = metric === "gap" ? "No finite gap samples are logged. Try Objective bounds or inspect the final report." : "No finite objective values are logged in this run.";
      byId("chartReadout").replaceChildren(el("p", "", "Choose a recorded point to inspect its source."));
      byId("chartDescription").textContent = "The raw log and final report remain available below.";
      return;
    }
    let min = metric === "gap" ? 0 : values.reduce((low, value) => Math.min(low, value), Infinity);
    let max = values.reduce((high, value) => Math.max(high, value), -Infinity);
    if (metric === "gap") max = Math.max(max * 1.08, .01);
    else {
      const padding = Math.max((max - min) * .07, Math.abs(max) * .001, .01);
      min -= padding; max += padding;
    }
    const x = (time) => plot.left + time / plot.maxTime * (plot.right - plot.left);
    const y = (value) => plot.bottom - (value - min) / (max - min) * (plot.bottom - plot.top);
    const axis = (value) => Math.abs(value) >= 1000
      ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
      : value !== 0 && Math.abs(value) < .001 ? value.toExponential(1) : fmt(value, metric === "gap" ? phone ? 1 : 3 : phone ? 1 : 2);
    plot.x = x; plot.y = y;
    const defs = svgEl("defs"), clip = svgEl("clipPath", { id: "plotClip" });
    clip.append(svgEl("rect", { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top }));
    defs.append(clip); chart.append(defs);
    for (let i = 0; i <= 4; i += 1) {
      const value = min + (max - min) * i / 4, yy = y(value);
      chart.append(svgEl("line", { x1: plot.left, y1: yy, x2: plot.right, y2: yy, class: "chart-grid" }));
      chart.append(svgEl("text", { x: plot.left - 13, y: yy + 5, "text-anchor": "end", class: "chart-label" }, axis(value) + (metric === "gap" ? "%" : "")));
    }
    const tickCount = window.matchMedia("(max-width: 700px)").matches ? 3 : 6;
    for (let i = 0; i <= tickCount; i += 1) {
      const value = plot.maxTime * i / tickCount, xx = x(value);
      chart.append(svgEl("line", { x1: xx, y1: plot.top, x2: xx, y2: plot.bottom, class: "chart-grid vertical" }));
      chart.append(svgEl("text", { x: xx, y: plot.bottom + 26, "text-anchor": "middle", class: "chart-label" }, axis(value) + " s"));
    }
    chart.append(svgEl("text", { x: plot.left, y: 355, class: "chart-label" }, metric === "gap" ? "Reported relative gap (%)" : "Reported primal value (solid) and dual bound (thin dashed)"));
    const lines = svgEl("g", { "clip-path": "url(#plotClip)" });
    for (const key of ["A", "B"]) {
      const fields = metric === "gap" ? ["gap"] : ["incumbent", "bound"];
      for (const field of fields) {
        let path = "", last = null;
        for (const point of series[key]) {
          if (!finite(point[field])) { last = null; continue; }
          const xx = x(point.time), yy = y(point[field]);
          path += last ? " H " + xx + " V " + yy : " M " + xx + " " + yy;
          last = point;
        }
        if (path) lines.append(svgEl("path", {
          d: path, fill: "none", stroke: colors[key], "stroke-width": field === "bound" ? 1.6 : 3,
          "stroke-dasharray": field === "bound" ? "4 4" : key === "B" ? "8 4" : "none",
          "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", class: "trace-" + key.toLowerCase()
        }));
        // Keep every step vertex and hover sample; only dense point decorations are omitted.
        for (const point of series[key]) if (finite(point[field]) && series[key].length <= 250) {
          const targetLine = point.lines[field] || point.line;
          const dot = svgEl("circle", { cx: x(point.time), cy: y(point[field]), r: field === "bound" ? 2 : 4, fill: colors[key], class: "chart-point", tabindex: field === "bound" ? "-1" : "0", role: "button", "aria-label": "Run " + key + ", " + seconds(point.time) + ", " + field + " " + fmt(point[field], 8) });
          dot.addEventListener("click", () => { inspectTime(point.time); if (targetLine) showSource(key, targetLine, true); });
          dot.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspectTime(point.time); if (targetLine) showSource(key, targetLine, true); } });
          dot.append(svgEl("title", {}, "Run " + key + ": " + seconds(point.time) + "; " + field + " " + fmt(point[field], 8)));
          lines.append(dot);
        }
      }
    }
    chart.append(lines);
    chart.append(svgEl("line", { id: "scrubLine", x1: plot.left, x2: plot.left, y1: plot.top, y2: plot.bottom, class: "scrub-line", visibility: "hidden" }));
    const note = "Step curves hold the last recorded sample. Final-report points use the report’s printed time and precision.";
    byId("chartDescription").textContent = state.example ? note + " Example: two individual runs of the published analytic-centre prototype; these are logged solve times, not whole-call medians." : note + " Missing or infinite samples remain absent.";
    inspectTime(state.hover === null ? plot.maxTime : Math.min(state.hover, plot.maxTime));
  }

  function inspectTime(time) {
    state.hover = time;
    const line = byId("scrubLine");
    if (line && plot.x) {
      line.setAttribute("x1", plot.x(time)); line.setAttribute("x2", plot.x(time)); line.setAttribute("visibility", "visible");
    }
    const box = byId("chartReadout");
    box.replaceChildren(el("p", "readout-time", "At or before " + seconds(time)));
    for (const key of ["A", "B"]) {
      const points = plot.series[key] || [];
      let point = null;
      for (const sample of points) if (sample.time <= time + 1e-9) point = sample;
      const row = el("p", "readout-row run-" + key.toLowerCase());
      if (!point) row.textContent = "Run " + key + ": no earlier sample.";
      else {
        const text = "Run " + key + " at " + seconds(point.time) + ": " + (byId("plotMetric").value === "gap"
          ? "gap " + (finite(point.gap) ? percent(point.gap) : point.gapText || "not logged")
          : "primal " + (finite(point.incumbent) ? fmt(point.incumbent, 8) : point.incumbentText || "not logged") + " / dual " + (finite(point.bound) ? fmt(point.bound, 8) : point.boundText || "not logged")) + " (" + point.source.toLowerCase() + ")";
        row.append(el("span", "", text));
        if (byId("plotMetric").value === "bounds" && point.source === "Final report") {
          if (point.lines.incumbent) row.append(document.createTextNode(" "), sourceLink(key, point.lines.incumbent, "Primal source"));
          if (point.lines.bound) row.append(document.createTextNode(" "), sourceLink(key, point.lines.bound, "Dual source"));
        } else if (point.line) row.append(document.createTextNode(" "), sourceLink(key, point.line, "View line " + point.line));
      }
      box.append(row);
    }
  }

  function showSource(key, line, reveal = false) {
    if (!current(key)) key = current("A") ? "A" : "B";
    const run = current(key), pre = byId("rawLines");
    if (!run) { pre.textContent = "Open a log to inspect its source."; return; }
    const target = Math.max(run.startLine, Math.min(run.endLine, Number(line) || run.startLine));
    state.source = { slot: key, line: target };
    byId("rawRun").value = key;
    byId("evidencePane").open = true;
    const start = Math.max(run.startLine, target - 12), end = Math.min(run.endLine, start + 39);
    byId("sourceTitle").textContent = "Run " + key + " / original lines " + start + "–" + end + " of " + run.startLine + "–" + run.endLine;
    pre.replaceChildren();
    for (const original of run.lines) {
      if (original.number < start || original.number > end) continue;
      const row = el("span", "line" + (original.number === target ? " line-selected" : ""));
      row.append(el("span", "line-number", String(original.number).padStart(5, " ")), document.createTextNode("  " + original.text + "\n"));
      pre.append(row);
    }
    byId("sourcePrev").disabled = start === run.startLine;
    byId("sourceNext").disabled = end === run.endLine;
    if (reveal && window.matchMedia("(max-width: 980px)").matches) byId("evidencePane").scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function render() {
    for (const key of ["A", "B"]) {
      const select = byId("run" + key);
      select.replaceChildren();
      slots[key].runs.forEach((run, index) => {
        const option = el("option", "", "Run " + (index + 1) + " / " + (run.modelType || "HiGHS") + " / " + (run.summary.status || "no final report"));
        option.value = index; select.append(option);
      });
      select.disabled = slots[key].runs.length < 2;
      select.closest(".run-picker").hidden = slots[key].runs.length < 2;
      select.value = String(slots[key].index);
      renderSummary(key);
    }
    renderFindings(); renderPhases(); renderComparison(); renderPlot();
    showSource(state.source.slot, state.source.line);
  }

  function assignLog(key, text, label, resetContext = true) {
    const runs = window.SolveTrailParser.parse(text, label);
    if (!runs.length) throw new Error("No HiGHS run detected. Open a text log containing the HiGHS header or native model report.");
    slots[key] = { text, label, runs, index: runs.length - 1 };
    if (resetContext) resetComparisonContext();
    const selected = runs[runs.length - 1];
    state.hover = null; state.source = { slot: key, line: selected.summary.statusLine || (selected.progress.length ? selected.progress[selected.progress.length - 1].line : selected.startLine) };
  }

  async function openFile(key, file) {
    if (!file) return;
    // A 20 MiB per-log ceiling keeps text + source views within browser memory.
    // Add streaming only when an actual larger user log requires it.
    if (file.size > 20 * 1024 * 1024) { message("This log exceeds the 20 MiB text limit. Capture one run per file or a relevant excerpt."); return; }
    try {
      assignLog(key, await file.text(), file.name);
      render(); message("Opened " + file.name + " locally. " + slots[key].runs.length + " run(s) detected.");
    } catch (error) { message(error.message); }
  }

  function loadExample() {
    assignLog("A", window.SolveTrailSamples.a, "Example: centre on", false);
    assignLog("B", window.SolveTrailSamples.b, "Example: centre off", false);
    state.example = true; state.hover = null;
    byId("relationship").value = "same"; byId("hardware").checked = true;
    byId("notes").value = "Published research prototype: same master MPS, HiGHS 1.16.0 / 725b40f, same host and 2 threads. One explicit analytic-centre option changed. These are two individual recorded runs; a three-pair whole-call analysis is available in the source study.";
    render(); message("Recorded example loaded. Open your own logs to start a private comparison.");
  }

  function workspace() {
    return {
      tool: "SolveTrail", format: 1, savedAt: new Date().toISOString(),
      a: { text: slots.A.text, label: slots.A.label, index: slots.A.index },
      b: { text: slots.B.text, label: slots.B.label, index: slots.B.index },
      context: context(), view: { metric: byId("plotMetric").value }, example: state.example
    };
  }

  function restore(data) {
    if (!data || data.tool !== "SolveTrail" || data.format !== 1 || !data.a || !data.b || typeof data.a.text !== "string" || typeof data.b.text !== "string") throw new Error("Open a SolveTrail format 1 comparison JSON file.");
    const prepared = {};
    for (const [key, value] of [["A", data.a], ["B", data.b]]) {
      const runs = value.text ? window.SolveTrailParser.parse(value.text, value.label || "Run " + key) : [];
      if (value.text && !runs.length) throw new Error("The saved Run " + key + " contains no recognizable HiGHS log.");
      prepared[key] = { text: value.text, label: value.label || "Run " + key, runs, index: Math.min(Math.max(Number(value.index) || 0, 0), Math.max(0, runs.length - 1)) };
    }
    slots.A = prepared.A; slots.B = prepared.B;
    const declaration = data.context || {};
    byId("relationship").value = ["same", "reformulation", "different"].includes(declaration.relationship) ? declaration.relationship : "unspecified";
    byId("hardware").checked = declaration.hardware === true;
    byId("notes").value = typeof declaration.notes === "string" ? declaration.notes : "";
    byId("plotMetric").value = data.view && data.view.metric === "bounds" ? "bounds" : "gap";
    state.example = data.example === true; state.hover = null; state.source = { slot: "A", line: 1 };
    render();
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = el("a"); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildBrief() {
    const declaration = context();
    const labels = { unspecified: "Not declared", same: "Same input model (owner declaration)", reformulation: "Reformulation of the same problem (owner declaration)", different: "Different models" };
    const lines = [
      "# HiGHS run comparison", "",
      "Generated locally with SolveTrail. Facts below are taken from solver logs; full model/witness validation belongs to the application acceptance.", "",
      "## Comparison context",
      "- Model relationship: " + labels[declaration.relationship],
      "- Hardware/resource budget: " + (declaration.hardware ? "same, declared by owner" : "not declared"),
      "- Intended change and notes: " + (declaration.notes.trim() || "Add the exact version, seed, limits and intended change."), ""
    ];
    for (const key of ["A", "B"]) {
      const run = current(key); lines.push("## Run " + key);
      if (!run) { lines.push("No log loaded.", ""); continue; }
      const s = run.summary;
      lines.push(
        "- HiGHS build: " + (run.version || "not logged") + (run.hash ? " / " + run.hash : ""),
        "- Reported final status: " + (s.status || "no final report"),
        "- Reported solver time: " + seconds(s.totalTime),
        "- Last progress sample: " + (run.progress.length ? seconds(run.progress[run.progress.length - 1].time) : "not logged"),
        "- Reported primal / dual: " + (s.primalText || "not logged") + " / " + (s.dualText || "not logged"),
        "- Reported final gap / tolerance: " + percent(s.gap) + " / " + percent(s.tolerance),
        "- Input rows / columns / nonzeros: " + fmt(run.input.rows, 0) + " / " + fmt(run.input.cols, 0) + " / " + fmt(run.input.nonzeros, 0),
        "- Logged threads: " + fmt(run.threads, 0)
      );
      for (const [phase, value] of Object.entries(s.phases)) if (value) lines.push("- " + phase + ": " + seconds(value.seconds) + " (source line " + value.line + ")");
      lines.push("", "### Source-backed observations");
      for (const fact of facts(run)) if (fact.title !== "Solver warning") lines.push("- " + fact.title + ": " + fact.detail + (fact.line ? " (line " + fact.line + ")" : ""));
      lines.push("");
    }
    lines.push("## This pair");
    comparison(current("A"), current("B"), declaration).lines.forEach((line) => lines.push("- " + line));
    lines.push("", "## Next controlled run",
      "Keep the input revision, hardware/resource budget and intended change explicit; record HiGHS build, threads, seed and limits alongside the next logs. Repeat a timing pair in alternating order to separate run variation from the change.",
      "", "## Engineering goal",
      "Add the production target, expected result, release date and scope you want delivered.",
      "", "This brief omits raw logs, file names and model paths. Review your own notes before sharing.",
      "Tool: https://blucca.github.io/solve-trail/");
    return lines.join("\n");
  }

  function init() {
    for (const key of ["A", "B"]) {
      byId("load" + key).addEventListener("click", () => byId("file" + key).click());
      byId("file" + key).addEventListener("change", (event) => { openFile(key, event.target.files[0]); event.target.value = ""; });
      byId("run" + key).addEventListener("change", (event) => { slots[key].index = Number(event.target.value); resetComparisonContext(); state.hover = null; state.source = { slot: key, line: current(key).startLine }; render(); });
    }
    byId("loadExample").addEventListener("click", loadExample);
    byId("pasteApply").addEventListener("click", () => {
      try {
        const key = byId("pasteTarget").value;
        assignLog(key, byId("pasteText").value, "Pasted log " + key);
        byId("pastePane").open = false; render(); message("Pasted log parsed locally.");
      } catch (error) { message(error.message); }
    });
    byId("saveWorkspace").addEventListener("click", () => {
      if (!current("A") && !current("B")) { message("Open a log before saving a comparison."); return; }
      download("solve-trail-comparison.json", JSON.stringify(workspace(), null, 2), "application/json");
      byId("saveWorkspace").closest("details").open = false;
      message("Saved a private comparison containing your raw logs and notes. Open this JSON here or in the offline app to continue.");
    });
    byId("restoreWorkspace").addEventListener("click", () => byId("workspaceFile").click());
    byId("workspaceFile").addEventListener("change", async (event) => {
      const file = event.target.files[0]; if (!file) return;
      try { restore(JSON.parse(await file.text())); byId("saveWorkspace").closest("details").open = false; message("Private comparison reopened locally."); }
      catch (error) { message(error.message); }
      event.target.value = "";
    });
    byId("makeBrief").addEventListener("click", () => {
      byId("briefText").value = buildBrief(); updateEmailDraft(); byId("briefDialog").showModal();
    });
    function updateEmailDraft() {
      const link = byId("briefDialog").querySelector("a[href^='mailto:']");
      if (link) link.href = "mailto:belgialucca@gmail.com?subject=HiGHS%20model%20engineering&body=" + encodeURIComponent(byId("briefText").value);
      byId("copyBrief").textContent = "Copy brief";
    }
    byId("briefText").addEventListener("input", updateEmailDraft);
    byId("closeBrief").addEventListener("click", () => byId("briefDialog").close());
    byId("downloadBrief").addEventListener("click", () => download("highs-run-comparison.md", byId("briefText").value, "text/markdown;charset=utf-8"));
    byId("copyBrief").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(byId("briefText").value); byId("copyBrief").textContent = "Copied"; }
      catch (_) { byId("briefText").focus(); byId("briefText").select(); byId("copyBrief").textContent = "Text selected"; }
    });
    byId("plotMetric").addEventListener("change", renderPlot);
    ["relationship", "hardware", "notes"].forEach((id) => byId(id).addEventListener("input", renderComparison));
    byId("rawRun").addEventListener("change", (event) => showSource(event.target.value, current(event.target.value) ? current(event.target.value).startLine : 1));
    byId("sourcePrev").addEventListener("click", () => showSource(state.source.slot, state.source.line - 30));
    byId("sourceNext").addEventListener("click", () => showSource(state.source.slot, state.source.line + 30));
    byId("chart").addEventListener("pointermove", (event) => {
      if (!plot.x) return;
      const rect = byId("chart").getBoundingClientRect(), xx = (event.clientX - rect.left) / rect.width * 1000;
      const time = Math.max(0, Math.min(plot.maxTime, (xx - plot.left) / (plot.right - plot.left) * plot.maxTime));
      inspectTime(time);
    });
    window.SolveTrail = { workspace, restore, buildBrief, facts, comparison, current };
    loadExample();
  }

  init();
})();
