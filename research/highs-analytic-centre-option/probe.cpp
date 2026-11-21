// MIT. Independent native result checks for HiGHS issue 3761.
// Reads the original model through HiGHS; recomputes all primal checks in
// long double. Dual bounds come from the native solver.
#ifdef NDEBUG
#error "The result probe requires assertions; build this target with -UNDEBUG."
#endif
#include "Highs.h"
#include <cassert>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <string>
#include <sys/resource.h>
#include <vector>

static const char* option = "mip_compute_analytic_centre";
static void ok(HighsStatus status) { assert(status == HighsStatus::kOk); }
static double cpu() {
  rusage r{}; assert(getrusage(RUSAGE_SELF, &r) == 0);
  return r.ru_utime.tv_sec + r.ru_utime.tv_usec * 1e-6 +
         r.ru_stime.tv_sec + r.ru_stime.tv_usec * 1e-6;
}
static double seconds(std::chrono::steady_clock::time_point start) {
  return std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
}

int main(int argc, char** argv) {
  assert(argc >= 3);
  Highs h;
  ok(h.setOptionValue("output_flag", false));
  if (std::string(argv[1]) == "--option-check") {
    bool value = false;
    ok(h.getOptionValue(option, value)); assert(value);
    ok(h.setOptionValue(option, std::string("false")));
    ok(h.getOptionValue(option, value)); assert(!value);
    Highs copy; ok(copy.passOptions(h.getOptions()));
    ok(copy.getOptionValue(option, value)); assert(!value);
    ok(h.resetOptions());
    ok(h.getOptionValue(option, value)); assert(value);
    ok(h.readOptions(argv[2]));
    ok(h.getOptionValue(option, value)); assert(!value);
    std::cout << "default/string/copy/reset/options-file PASS\n";
    return 0;
  }
  assert(argc == 5); // original MPS, mode, output prefix, threads
  const std::string mode = argv[2], prefix = argv[3];
  const int threads = std::stoi(argv[4]); assert(threads > 0);
  ok(h.setOptionValue("threads", HighsInt(threads)));
  ok(h.setOptionValue("time_limit", 120.0)); // independent resource ceiling
  ok(h.setOptionValue("output_flag", true));
  ok(h.setOptionValue("log_to_console", false));
  ok(h.setOptionValue("log_file", prefix + ".log"));
  ok(h.setOptionValue("highs_analysis_level", HighsInt(128)));
  ok(h.setOptionValue("log_dev_level", HighsInt(1)));
  if (mode == "true" || mode == "false")
    ok(h.setOptionValue(option, mode == "true"));
  else assert(mode == "stock" || mode == "default" || mode == "constant-off");

  const auto load_start = std::chrono::steady_clock::now();
  ok(h.readModel(argv[1]));
  const double load_wall = seconds(load_start);
  const auto start = std::chrono::steady_clock::now();
  const double cpu_start = cpu();
  ok(h.run());
  const double wall = seconds(start), process_cpu = cpu() - cpu_start;
  const auto& lp = h.getLp(); const auto& sol = h.getSolution();
  const auto& info = h.getInfo();
  assert(sol.value_valid && sol.col_value.size() == size_t(lp.num_col_));
  assert(lp.a_matrix_.format_ == MatrixFormat::kColwise);
  assert(lp.a_matrix_.start_.size() == size_t(lp.num_col_ + 1));
  std::vector<long double> activity(lp.num_row_, 0);
  long double objective = lp.offset_, bounds = 0, integer = 0;
  HighsInt integers = 0;
  for (HighsInt j=0; j<lp.num_col_; ++j) {
    const long double x = sol.col_value[j]; assert(std::isfinite(x));
    objective += static_cast<long double>(lp.col_cost_[j])*x;
    bounds = std::max(bounds, std::max(static_cast<long double>(lp.col_lower_[j])-x,
                                    x-static_cast<long double>(lp.col_upper_[j])));
    if (!lp.integrality_.empty() && lp.integrality_[j] != HighsVarType::kContinuous) {
      assert(lp.integrality_[j] == HighsVarType::kInteger); // original BV scope
      ++integers; integer = std::max(integer, std::abs(x-std::round(x)));
    }
    for (HighsInt k=lp.a_matrix_.start_[j]; k<lp.a_matrix_.start_[j+1]; ++k)
      activity[lp.a_matrix_.index_[k]] += static_cast<long double>(lp.a_matrix_.value_[k])*x;
  }
  long double rows = 0;
  for (HighsInt i=0; i<lp.num_row_; ++i)
    rows = std::max(rows, std::max(static_cast<long double>(lp.row_lower_[i])-activity[i],
                                 activity[i]-static_cast<long double>(lp.row_upper_[i])));
  double tolerance = 0; ok(h.getOptionValue("mip_feasibility_tolerance", tolerance));
  const long double objective_delta = std::abs(objective-info.objective_function_value);
  assert(bounds <= tolerance && rows <= tolerance && integer <= tolerance);
  assert(objective_delta <= 1e-8L*(1+std::abs(objective)));
  assert(h.getModelStatus() == HighsModelStatus::kOptimal);
  rusage usage{}; assert(getrusage(RUSAGE_SELF, &usage) == 0);
  std::ofstream out(prefix+".json"); assert(out.good());
  out << std::setprecision(17) << "{\n"
      << "  \"mode\": \"" << mode << "\",\n"
      << "  \"version\": \"" << h.version() << "\",\n"
      << "  \"threads\": " << threads << ",\n"
      << "  \"model_load_wall_seconds\": " << load_wall << ",\n"
      << "  \"run_wall_seconds\": " << wall << ",\n"
      << "  \"run_process_cpu_seconds\": " << process_cpu << ",\n"
      << "  \"peak_rss_kib\": " << usage.ru_maxrss << ",\n"
      << "  \"columns\": " << lp.num_col_ << ", \"rows\": " << lp.num_row_ << ",\n"
      << "  \"integer_columns\": " << integers << ",\n"
      << "  \"model_status\": \"Optimal\",\n"
      << "  \"primal\": " << info.objective_function_value << ",\n"
      << "  \"dual_bound\": " << info.mip_dual_bound << ",\n"
      << "  \"gap\": " << info.mip_gap << ",\n"
      << "  \"lp_iterations\": " << info.simplex_iteration_count << ",\n"
      << "  \"nodes\": " << info.mip_node_count << ",\n"
      << "  \"mip_feasibility_tolerance\": " << tolerance << ",\n"
      << "  \"max_bound_violation\": " << bounds << ",\n"
      << "  \"max_row_violation\": " << rows << ",\n"
      << "  \"max_integrality_violation\": " << integer << ",\n"
      << "  \"recomputed_objective\": " << objective << ",\n"
      << "  \"objective_delta\": " << objective_delta << "\n}\n";
  assert(out.good());
  std::cout << mode << " full primal check PASS (" << wall << "s)\n";
}
