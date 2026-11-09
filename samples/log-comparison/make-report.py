"""One-page illustrative report. Run: python make-report.py (requires matplotlib).

This fixed sample compares exact lines, including timestamps. A client report
first agrees its file pairs, timestamp policy and indicators from a real sample.
"""
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
import re
from statistics import median

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parent
runs = [(ROOT / f"run-{r}.log").read_text().splitlines() for r in ("a", "b")]
levels = [Counter(line.split()[1] for line in lines) for lines in runs]
latency = [[int(v) for line in lines for v in re.findall(r"latency_ms=(\d+)", line)] for lines in runs]
accepted = [int(re.search(r"accepted=(\d+)", lines[-1])[1]) for lines in runs]
diff = []
for tag, a0, a1, b0, b1 in SequenceMatcher(None, *runs, autojunk=False).get_opcodes():
    if tag in ("delete", "replace"):
        diff.extend(("removed", n + 1, runs[0][n]) for n in range(a0, a1))
    if tag in ("insert", "replace"):
        diff.extend(("added", n + 1, runs[1][n]) for n in range(b0, b1))
changes = Counter(row[0] for row in diff)
# A single minimal check covers parsing, replacement counts and report numbers.
assert changes == {"removed": 5, "added": 4} and levels[0]["ERROR"] == 1
assert levels[1]["ERROR"] == 0 and list(map(median, latency)) == [235, 110]
assert accepted == [2, 3]

ink, blue, grey, coral = "#172A44", "#265BEF", "#8A96A3", "#D94734"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "text.color": ink,
                     "axes.labelcolor": ink, "xtick.color": ink, "ytick.color": ink,
                     "pdf.fonttype": 42})
fig = plt.figure(figsize=(8.27, 11.69), facecolor="white")
fig.text(.08, .93, "Dispatch logs: change review", fontsize=21, weight="bold")
fig.text(.08, .902, "Synthetic files • illustrative report • generated from the linked logs", fontsize=9, color=grey)
fig.text(.08, .858, f"Run B accepted {accepted[1]} of 3 records; Run A accepted {accepted[0]}.", fontsize=13, weight="bold")
fig.text(.08, .832, f"Recorded median request latency: {median(latency[0]):.0f} ms → {median(latency[1]):.0f} ms.", fontsize=10)
fig.text(.08, .809, f"Exact-line comparison: {changes['removed']} removed, {changes['added']} added, 1 unchanged.", fontsize=10)

for idx, title in enumerate(("Events by severity", "Recorded request latency")):
    ax = fig.add_axes([.10 + idx * .45, .59, .32, .16])
    ax.set_title(title, loc="left", fontsize=10, weight="bold", pad=12)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color("#CDD7E0")
    ax.grid(axis="y", color="#EDF1F5", linewidth=.7)
    ax.set_axisbelow(True)
    ax.tick_params(axis="both", length=0)
    if idx == 0:
        for j, (name, color) in enumerate((("Run A", grey), ("Run B", blue))):
            ax.bar([x + (j - .5) * .32 for x in range(3)],
                   [levels[j][l] for l in ("INFO", "WARN", "ERROR")], .3,
                   color=color, label=name)
        ax.set_xticks(range(3), ("Info", "Warn", "Error"))
        ax.set_yticks(range(6)); ax.set_ylim(0, 5.8)
        ax.legend(frameon=False, fontsize=8, loc="upper right")
    else:
        for j, (values, color) in enumerate(zip(latency, (grey, blue))):
            ax.scatter([j] * len(values), values, s=24, color=color, alpha=.8)
            ax.hlines(median(values), j - .16, j + .16, color=ink, linewidth=2)
        ax.set_xticks((0, 1), ("Run A", "Run B")); ax.set_xlim(-.5, 1.5)
        ax.set_ylabel("ms", rotation=0, labelpad=9); ax.set_ylim(0, 740)
        ax.text(0, -.27, "Each dot is a recorded request; bar = median.", transform=ax.transAxes, fontsize=7.5)

fig.text(.08, .535, "Line-level changes", fontsize=13, weight="bold")
fig.text(.08, .512, "File-local line numbers. Replacements appear as a removal plus an addition.", fontsize=8, color=grey)
for i, (action, number, line) in enumerate(diff):
    y = .467 - i * .033
    color = coral if action == "removed" else blue
    fig.patches.append(Rectangle((.08, y - .01), .84, .029, facecolor="#FAF5F4" if action == "removed" else "#F3F6FC", edgecolor="none", transform=fig.transFigure, zorder=-1))
    fig.text(.093, y, f"{'A' if action == 'removed' else 'B'}:{number:02d}", color=color, fontsize=8, weight="bold")
    fig.text(.158, y, "−" if action == "removed" else "+", color=color, fontsize=9, weight="bold")
    fig.text(.185, y, line, fontsize=7.8, fontfamily="DejaVu Sans Mono")

fig.text(.08, .112, "Reading the comparison", fontsize=10, weight="bold")
fig.text(.08, .09, "Timestamps are preserved. Counts include retry attempts; latency dots are observations,", fontsize=8)
fig.text(.08, .073, "and the two short runs supply this sample's complete evidence. Client indicators are agreed", fontsize=8)
fig.text(.08, .056, "from the supplied format before the full report. Source: run-a.log, run-b.log, make-report.py.", fontsize=8)
fig.text(.92, .025, "Blucca • AI-led engineering", fontsize=7.5, color=grey, ha="right")
fig.savefig(ROOT / "report.pdf", metadata={"Title": "Dispatch logs: change review", "Author": "Blucca", "Subject": "Synthetic log-comparison sample"})
plt.close(fig)
print({"status": "passed", "files": len(runs), "line_counts": list(map(len, runs)), "changes": dict(changes), "median_ms": list(map(median, latency)), "pdf_bytes": (ROOT / "report.pdf").stat().st_size})
