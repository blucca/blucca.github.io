#!/usr/bin/env bash
# MIT. One original public model, one shared source fix, existing presolve tests.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
OUT=${1:?Use a fresh directory under your workspace temp/}
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
test ! -e "$OUT/source"
SHA=725b40f68247d0e2a00fa4f29d6ca6bde01bd151
stage=source
trap 'printf "%s %s\n" "$stage" "$?" > "$OUT/state.txt"' EXIT
git init -q "$OUT/source"
git -C "$OUT/source" remote add origin https://github.com/ERGO-Code/HiGHS.git
git -C "$OUT/source" fetch -q --depth 1 origin "$SHA"
git -C "$OUT/source" checkout -q --detach FETCH_HEAD
test "$(git -C "$OUT/source" rev-parse HEAD)" = "$SHA"
curl -fLsS --max-time 120 \
  https://github.com/user-attachments/files/35226594/highs_presolve_infeasible.mps.txt \
  -o "$OUT/original.mps"
python3 "$HERE/exact_optimality_check.py" "$OUT/original.mps" "$HERE/exact-optimality-certificate.json" > "$OUT/exact-check.json"
python3 "$HERE/instrument_source.py" "$OUT/source"
cat >> "$OUT/source/CMakeLists.txt" <<EOF

add_executable(native_result_probe "$HERE/native_result_probe.cpp")
target_link_libraries(native_result_probe PRIVATE highs)
target_compile_features(native_result_probe PRIVATE cxx_std_17)
target_compile_options(native_result_probe PRIVATE -UNDEBUG)
EOF
stage=stock-build
cmake -S "$OUT/source" -B "$OUT/build" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_SHARED_EXTRAS_LIB=OFF \
  -DBUILD_TESTING=ON -DALL_TESTS=ON -DBUILD_EXAMPLES=OFF > "$OUT/configure.log" 2>&1
timeout 600 cmake --build "$OUT/build" --parallel 2 --target native_result_probe > "$OUT/stock-build.log" 2>&1
mkdir -p "$OUT/bin"
cp "$OUT/build/bin/native_result_probe" "$OUT/bin/stock"
stage=stock-run
timeout 90 "$OUT/bin/stock" "$OUT/original.mps" "$OUT/runs/stock-default" default > "$OUT/stock-default.stdout" 2> "$OUT/stock-trace.stderr"
for type in lp mip; do
  timeout 90 "$OUT/bin/stock" "--tiny-$type" "$OUT/tiny/stock-$type" default > "$OUT/stock-$type.stdout" 2>&1
done
stage=fixed-build
git -C "$OUT/source" restore -- highs/presolve/HPresolve.cpp highs/presolve/HPresolveProbingUtil.cpp
python3 "$HERE/apply_fix.py" "$OUT/source"
git -C "$OUT/source" diff -- highs/presolve/HPresolve.cpp > "$OUT/candidate.patch"
timeout 600 cmake --build "$OUT/build" --parallel 2 --target native_result_probe unit_tests > "$OUT/fixed-build.log" 2>&1
stage=fixed-run
timeout 90 "$OUT/build/bin/native_result_probe" "$OUT/original.mps" "$OUT/runs/fixed-default" default > "$OUT/fixed-default.stdout" 2>&1
timeout 90 "$OUT/build/bin/native_result_probe" "$OUT/original.mps" "$OUT/runs/fixed-lp" lp > "$OUT/fixed-lp.stdout" 2>&1
for type in lp mip; do
  timeout 90 "$OUT/build/bin/native_result_probe" "--tiny-$type" "$OUT/tiny/fixed-$type" default > "$OUT/fixed-$type.stdout" 2>&1
done
python3 "$HERE/check_original.py" "$OUT/original.mps" "$OUT/runs" "$OUT/full-primal-check.json" > "$OUT/full-primal-check.stdout"
python3 "$HERE/tiny_result_assert.py" --mip-scope \
  "$OUT/tiny/fixed-lp/result.json" "$OUT/tiny/fixed-mip/result.json" \
  "$OUT/tiny/stock-lp/result.json" "$OUT/tiny/stock-mip/result.json" > "$OUT/tiny-check.stdout"
stage=standard-presolve-tests
timeout 300 "$OUT/build/bin/unit_tests" '[highs_test_presolve],[highs_test_presolve_rules]' > "$OUT/standard-tests.log" 2>&1
stage=complete-mip-scope
