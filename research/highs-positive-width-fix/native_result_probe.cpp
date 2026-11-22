// MIT. Independent public-API result probe for HiGHS issue 3768.
// Reuses the result-recording approach of the MIT issue-3761 native probe.
// HiGHS and the author's original MPS retain their original attribution.
#ifdef NDEBUG
#error "Build the result probe with -UNDEBUG."
#endif
#include "Highs.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>
#include <sys/resource.h>
#include <vector>

static void ok(HighsStatus s) { assert(s == HighsStatus::kOk); }
static void number(std::ostream& out, double x) {
  if (std::isfinite(x)) out << x;
  else out << std::quoted(std::isnan(x) ? "nan" : (x < 0 ? "-inf" : "inf"));
}
static void primal(std::ostream& out, const HighsLp& lp,
                   const HighsSolution& solution) {
  assert(solution.col_value.size() == size_t(lp.num_col_));
  assert(lp.col_names_.size() == size_t(lp.num_col_));
  out << "{";
  for (HighsInt j = 0; j < lp.num_col_; ++j) {
    out << (j ? ",\n    " : "\n    ") << std::quoted(lp.col_names_[j]) << ": ";
    number(out, solution.col_value[j]);
  }
  out << "\n  }";
}

int main(int argc, char** argv) {
  if (argc != 4) {
    std::cerr << "usage: probe <original.mps|--tiny-lp|--tiny-mip> OUTDIR "
                 "<default|lp|off|no-probing|no-enumeration>\n";
    return 2;
  }
  const std::string input = argv[1], mode = argv[3];
  const bool tiny_lp = input == "--tiny-lp", tiny_mip = input == "--tiny-mip";
  if (mode != "default" && mode != "lp" && mode != "off" &&
      mode != "no-probing" && mode != "no-enumeration") return 2;
  if ((tiny_lp || tiny_mip) && mode == "lp") {
    std::cerr << "lp mode changes only original x363; use --tiny-lp for the tiny LP\n";
    return 2;
  }
  const std::filesystem::path outdir = argv[2];
  std::filesystem::create_directories(outdir);
  Highs h;
  ok(h.setOptionValue("threads", HighsInt(1)));
  ok(h.setOptionValue("time_limit", 60.0));
  ok(h.setOptionValue("log_to_console", false));
  ok(h.setOptionValue("log_file", (outdir / "native.log").string()));
  if (mode == "off") ok(h.setOptionValue("presolve", std::string("off")));
  if (mode == "no-probing") ok(h.setOptionValue("presolve_rule_off", HighsInt(32768)));
  if (mode == "no-enumeration") ok(h.setOptionValue("presolve_rule_off", HighsInt(65536)));
  double lp_tol = 0, mip_tol = 0;
  ok(h.getOptionValue("primal_feasibility_tolerance", lp_tol));
  ok(h.getOptionValue("mip_feasibility_tolerance", mip_tol));
  const double tiny_tol = tiny_mip ? mip_tol : lp_tol;

  if (tiny_lp || tiny_mip) {
    assert(std::isfinite(tiny_tol) && tiny_tol > 0);
    const HighsInt n = tiny_mip ? 4 : 3;
    HighsLp lp;
    lp.num_col_ = n;
    lp.num_row_ = 1;
    lp.col_cost_.assign(n, -1.0);
    lp.col_lower_.assign(n, -tiny_tol);
    lp.col_upper_.assign(n, 0.0);
    lp.row_lower_ = {-kHighsInf};
    lp.row_upper_ = {1.5 * tiny_tol};
    lp.col_names_ = {"x0", "x1", "x2"};
    lp.row_names_ = {"r0"};
    lp.a_matrix_.format_ = MatrixFormat::kColwise;
    lp.a_matrix_.num_col_ = n;
    lp.a_matrix_.num_row_ = 1;
    lp.a_matrix_.start_.resize(n + 1);
    for (HighsInt j = 0; j <= n; ++j) lp.a_matrix_.start_[j] = j;
    lp.a_matrix_.index_.assign(n, 0);
    lp.a_matrix_.value_.assign(n, -1.0);
    if (tiny_mip) {
      lp.col_names_.push_back("z");
      lp.col_cost_[3] = 0.0;
      lp.col_lower_[3] = 0.0;
      lp.a_matrix_.value_[3] = -33.0;
      lp.integrality_.assign(n, HighsVarType::kContinuous);
      lp.integrality_[3] = HighsVarType::kInteger;
    }
    ok(h.passModel(lp));
  } else {
    ok(h.readModel(input));
    if (mode == "lp") {
      const auto& names = h.getLp().col_names_;
      assert(std::count(names.begin(), names.end(), "x363") == 1);
      const HighsInt j = std::find(names.begin(), names.end(), "x363") - names.begin();
      ok(h.changeColIntegrality(j, HighsVarType::kContinuous));
    }
  }

  const auto start = std::chrono::steady_clock::now();
  const HighsStatus run_status = h.run(); // Preserve native failure/invalid states.
  const double wall = std::chrono::duration<double>(
      std::chrono::steady_clock::now() - start).count();
  rusage usage{};
  assert(getrusage(RUSAGE_SELF, &usage) == 0);
  const auto& lp = h.getLp();
  const auto& solution = h.getSolution();
  std::ofstream result(outdir / "result.json");
  assert(result.good());
  result << std::setprecision(17) << std::boolalpha << "{\n"
         << "  \"mode\": " << std::quoted(mode) << ",\n"
         << "  \"model\": " << std::quoted(std::filesystem::path(input).filename().string()) << ",\n"
         << "  \"version\": " << std::quoted(h.version()) << ",\n"
         << "  \"run_status\": " << static_cast<int>(run_status) << ",\n"
         << "  \"model_status\": " << std::quoted(h.modelStatusToString(h.getModelStatus())) << ",\n"
         << "  \"objective\": ";
  number(result, h.getObjectiveValue());
  result << ",\n  \"value_valid\": " << solution.value_valid
         << ",\n  \"dual_valid\": " << solution.dual_valid
         << ",\n  \"rows\": " << lp.num_row_ << ",\n  \"cols\": " << lp.num_col_
         << ",\n  \"threads\": 1,\n  \"wall_seconds\": " << wall
         << ",\n  \"rss_kib\": " << usage.ru_maxrss
         << ",\n  \"primal_feasibility_tolerance\": ";
  number(result, lp_tol);
  result << ",\n  \"mip_feasibility_tolerance\": ";
  number(result, mip_tol);
  if (tiny_lp || tiny_mip) {
    result << ",\n  \"tiny_rhs\": ";
    number(result, 1.5 * tiny_tol);
  }
  if (solution.value_valid) {
    result << ",\n  \"primal\": ";
    primal(result, lp, solution);
  }
  result << "\n}\n";
  assert(result.good());
  std::cout << h.modelStatusToString(h.getModelStatus()) << " value_valid="
            << solution.value_valid << " -> " << (outdir / "result.json") << "\n";
  return run_status == HighsStatus::kError ? 1 : 0;
}
