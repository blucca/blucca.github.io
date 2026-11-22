"""Temporary phase/near-fixed diagnostics in a separate stock worktree."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
p = root / "highs/presolve/HPresolve.cpp"
s = p.read_text()
assert "#include <cstdio>" not in s
s = "#include <cstdio>\n" + s
needle = "  if (isFixed != nullptr) *isFixed = false;\n"
assert s.count(needle) == 1
s = s.replace(needle, needle + '''  if (boundDiff > 0 && boundDiff <= primal_feastol)
    std::fprintf(stderr, "TRACE_NEAR col=%lld lb=%.17g ub=%.17g maxa=%.17g fixed_query=%d\\n",
      (long long)col, model->col_lower_[col], model->col_upper_[col],
      getMaxAbsColVal(col), isFixed != nullptr);
''')
needle = "    // remove fixed column\n"
assert s.count(needle) == 1
s = s.replace(needle, '''    std::fprintf(stderr, "TRACE_FIX col=%lld lb=%.17g ub=%.17g name=%s\\n",
      (long long)col, model->col_lower_[col], model->col_upper_[col],
      model->col_names_.empty() ? "?" : model->col_names_[col].c_str());
''' + needle)
for label, needle in (
    ("ENUM", "        HPRESOLVE_CHECKED_CALL(enumerateSolutions(postsolve_stack));"),
    ("IMPLIED_INT", "        HPRESOLVE_CHECKED_CALL(detectImpliedIntegers());"),
    ("PROBE", "        HPRESOLVE_CHECKED_CALL(runProbing(postsolve_stack));"),
):
    assert s.count(needle) == 1
    s = s.replace(needle, f'        std::fprintf(stderr,"TRACE_BEGIN_{label} cols=%lld rows=%lld\\n",(long long)model->num_col_,(long long)model->num_row_);\n' + needle + f'\n        std::fprintf(stderr,"TRACE_END_{label} cols=%lld rows=%lld\\n",(long long)model->num_col_,(long long)model->num_row_);')
p.write_text(s)
p = root / "highs/presolve/HPresolveProbingUtil.cpp"
s = p.read_text()
s = "#include <cstdio>\n" + s
needle = "  domain.propagate();\n  if (domain.infeasible()) return Result::kPrimalInfeasible;"
assert s.count(needle) == 1
s = s.replace(needle, '''  std::fprintf(stderr,"TRACE_PREP_PROPAGATE cols=%lld rows=%lld first=%d\\n",(long long)model->num_col_,(long long)model->num_row_,firstCall);
  domain.propagate();
  std::fprintf(stderr,"TRACE_PREP_PROPAGATED infeasible=%d\\n",domain.infeasible());
  if (domain.infeasible()) return Result::kPrimalInfeasible;''')
p.write_text(s)
print("separate diagnostic source patched; no production fix applied")
