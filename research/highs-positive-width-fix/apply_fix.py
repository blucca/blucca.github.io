"""One shared presolve fix; apply only to the pinned clean source."""
from pathlib import Path
import sys

p = Path(sys.argv[1]) / "highs/presolve/HPresolve.cpp"
s = p.read_text()
old = """  if (boundDiff <= primal_feastol &&
      (boundDiff <= options->small_matrix_value ||
       getMaxAbsColVal(col) * boundDiff <= primal_feastol)) {"""
new = """  // Collapsing positive-width intervals independently can spend the same
  // row feasibility tolerance once per column and exclude a feasible point.
  if (boundDiff <= 0.0) {"""
assert s.count(old) == 1
p.write_text(s.replace(old, new))
print("shared checkColBounds preserves every positive-width interval")
