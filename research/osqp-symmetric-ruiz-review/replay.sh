#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Supply a fresh temporary work directory; all cloned/build outputs stay there.
set -eu
export GIT_TERMINAL_PROMPT=0
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORK=${1:?Usage: sh replay.sh /absolute/path/to/temp/osqp798}
mkdir -p "$WORK"
WORK=$(CDPATH= cd -- "$WORK" && pwd)
git init -q "$WORK/source"
git -C "$WORK/source" remote add origin https://github.com/osqp/osqp.git
git -C "$WORK/source" fetch -q --depth 1 origin 1572ae068e9ce9ca723cf8223548ade1ff7acc29
git -C "$WORK/source" checkout -q --detach FETCH_HEAD
git init -q "$WORK/qdldl"
git -C "$WORK/qdldl" remote add origin https://github.com/osqp/qdldl.git
git -C "$WORK/qdldl" fetch -q --depth 1 origin 138fdac58b9cd1c4137ff1b99152c8108a6cff5b
git -C "$WORK/qdldl" checkout -q --detach FETCH_HEAD
build_run() {
    name=$1
    cmake -S "$WORK/source" -B "$WORK/build-$name" \
      -DCMAKE_BUILD_TYPE=Release -DFETCHCONTENT_SOURCE_DIR_QDLDL="$WORK/qdldl" \
      -DOSQP_ALGEBRA_BACKEND=builtin -DOSQP_USE_FLOAT=OFF -DOSQP_USE_LONG=ON \
      -DOSQP_BUILD_STATIC_LIB=ON -DOSQP_BUILD_SHARED_LIB=OFF \
      -DOSQP_BUILD_DEMO_EXE=OFF -DOSQP_BUILD_UNITTESTS=OFF > "$WORK/configure-$name.log" 2>&1
    cmake --build "$WORK/build-$name" --parallel 2 > "$WORK/build-$name.log" 2>&1
    cc -std=c99 -O2 -I "$WORK/source/include/public" \
      -I "$WORK/build-$name/include/public" -I "$WORK/source/include/private" \
      -I "$WORK/source/algebra/_common" -I "$WORK/source/algebra/builtin" \
      "$HERE/review_native.c" "$WORK/build-$name/out/libosqpstatic.a" -lm \
      -o "$WORK/native-$name"
}
build_run stock
# Stock's two failures are the intended regression controls; other failures stop the replay.
stock_rc=0
"$WORK/native-stock" > "$WORK/native-stock.jsonl" || stock_rc=$?
test "$stock_rc" -eq 1
git -C "$WORK/source" apply "$HERE/author-proposed-fix.patch"
build_run fixed
"$WORK/native-fixed" > "$WORK/native-fixed.jsonl"
python3 "$HERE/check_pair.py" "$WORK/native-stock.jsonl" "$WORK/native-fixed.jsonl"
