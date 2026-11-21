#!/usr/bin/env bash
# MIT. A fresh, pinned full-instance replay; C++/CLI research prototype only.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
OUT=${1:?Give a fresh output directory under your workspace temp/}
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
SHA=725b40f68247d0e2a00fa4f29d6ca6bde01bd151
stage=source
status() {
  python3 - "$OUT/state.json" "$1" "$2" <<'PY'
import json,sys,time
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'stage':sys.argv[2],'exit_code':int(sys.argv[3]),'at_epoch':time.time()}))
PY
}
trap 'status "$stage" "$?"' EXIT
test ! -e "$OUT/source"
status "$stage" -1
git init -q "$OUT/source"
git -C "$OUT/source" remote add origin https://github.com/ERGO-Code/HiGHS.git
git -C "$OUT/source" fetch -q --depth 1 origin "$SHA"
git -C "$OUT/source" checkout -q --detach FETCH_HEAD
test "$(git -C "$OUT/source" rev-parse HEAD)" = "$SHA"
cp "$OUT/source/highs/mip/HighsMipSolverData.cpp" "$OUT/original-data.cpp"
curl -fLsS --max-time 120 https://github.com/user-attachments/files/35178654/master.mps.gz -o "$OUT/master.mps.gz"
python3 - "$OUT" <<'PY'
import gzip,sys
from pathlib import Path
p=Path(sys.argv[1]); raw=gzip.decompress((p/'master.mps.gz').read_bytes())
assert len(raw)==11261660 and raw.rstrip().endswith(b'ENDATA')
(p/'master.mps').write_bytes(raw)
PY
printf '\nadd_executable(centre-probe "%s/probe.cpp")\ntarget_link_libraries(centre-probe PRIVATE highs)\ntarget_compile_options(centre-probe PRIVATE -UNDEBUG)\n' "$HERE" >> "$OUT/source/CMakeLists.txt"
stage=stock-build; status "$stage" -1
cmake -S "$OUT/source" -B "$OUT/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_SHARED_EXTRAS_LIB=OFF -DBUILD_TESTING=OFF -DBUILD_EXAMPLES=OFF > "$OUT/configure.log" 2>&1
cmake --build "$OUT/build" --parallel 2 --target centre-probe > "$OUT/build-stock.log" 2>&1
mkdir -p "$OUT/bin" "$OUT/results"
cp "$OUT/build/bin/centre-probe" "$OUT/bin/stock"
run() { timeout 150 "$OUT/bin/$1" "$OUT/master.mps" "$2" "$OUT/results/$3" 2; }
stage=stock-run; status "$stage" -1
run stock stock stock-1
stage=candidate-build; status "$stage" -1
python3 "$HERE/apply_option.py" "$OUT/source"
git -C "$OUT/source" diff -- highs/lp_data/HighsOptions.h highs/mip/HighsMipSolverData.cpp > "$OUT/candidate.patch"
cmake --build "$OUT/build" --parallel 2 --target centre-probe > "$OUT/build-candidate.log" 2>&1
cp "$OUT/build/bin/centre-probe" "$OUT/bin/candidate"
printf 'mip_compute_analytic_centre = false\n' > "$OUT/false.options"
"$OUT/bin/candidate" --option-check "$OUT/false.options"
stage=candidate-runs; status "$stage" -1
for i in 1 2 3; do
  run candidate default "default-$i"
  run candidate false "false-$i"
done
run candidate true true-1
stage=control-build; status "$stage" -1
# Original author's constant-off control; retain the original source print.
python3 - "$OUT" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=(p/'original-data.cpp').read_text()
assert s.count('const bool compute_analytic_centre = true;')==1
(p/'source/highs/mip/HighsMipSolverData.cpp').write_text(s.replace('const bool compute_analytic_centre = true;', 'const bool compute_analytic_centre = false;'))
PY
cmake --build "$OUT/build" --parallel 2 --target centre-probe > "$OUT/build-control.log" 2>&1
cp "$OUT/build/bin/centre-probe" "$OUT/bin/constant-off"
stage=control-run; status "$stage" -1
run constant-off constant-off control-1
# Restore the tested candidate as the final working source/library.
stage=cli-build; status "$stage" -1
cp "$OUT/original-data.cpp" "$OUT/source/highs/mip/HighsMipSolverData.cpp"
git -C "$OUT/source" apply --include=highs/mip/HighsMipSolverData.cpp "$OUT/candidate.patch"
cmake --build "$OUT/build" --parallel 2 --target highs-bin > "$OUT/build-cli.log" 2>&1
cat > "$OUT/cli.options" <<EOF
mip_compute_analytic_centre = false
threads = 2
time_limit = 120
output_flag = false
solution_file = $OUT/cli.solution
EOF
stage=cli-run; status "$stage" -1
timeout 150 "$OUT/build/bin/highs" --options_file "$OUT/cli.options" "$OUT/master.mps" > "$OUT/cli.stdout" 2> "$OUT/cli.stderr"
python3 "$HERE/check_cli.py" "$OUT"
python3 "$HERE/summarize.py" "$OUT/results" "$OUT/summary.json"
stage=complete
