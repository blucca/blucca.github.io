"""One CPU source-module control for FlashInfer PR #8483.

The capture predicate is instrumented; no CUDA graph or FlashInfer kernel runs.
Uses the unchanged api_logging.py from the named PR head and real torch tensors.
"""

import importlib.util
import json
import os
from pathlib import Path
import sys

source, output = map(Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=True)
os.environ.update(
    FLASHINFER_LOGLEVEL="10",
    FLASHINFER_DUMP_GRAPH_SNAPSHOTS="1",
    FLASHINFER_DUMP_DIR=str(output / "dumps"),
    FLASHINFER_LOGDEST=str(output / "logging.txt"),
    FLASHINFER_DUMP_INCLUDE="review_op",
)

import torch

torch.set_num_threads(1)
spec = importlib.util.spec_from_file_location("review_logging", source)
logging = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = logging
spec.loader.exec_module(logging)


def review_op(x, state):
    x.add_(state)


review_op._flashinfer_mutates_args = ("x",)

results = []
for captured, later_write in ((False, True), (True, False), (True, True)):
    x, state = torch.tensor([1.0, 2.0]), torch.tensor([3.0, 4.0])
    before_state = state.clone()
    logging._is_current_stream_capturing = lambda: captured
    call = logging._dump_function_inputs(review_op, "review_op", (x, state), {})
    assert call is not None
    review_op(x, state)
    expected_x = x.clone()
    logging._dump_function_outputs(call, None, args=(x, state))
    if later_write:
        state.add_(10)
    logging._is_current_stream_capturing = lambda: False
    path = Path(call)
    if captured:
        logging.flush_graph_dumps(synchronize=False)
        path = next((path / "graph_flushes").glob("flush_*"))
    replay = logging.replay_from_dump(
        str(path), device="cpu", run=True, compare_outputs=True
    )
    assert "execution_error" not in replay, replay.get("execution_error")
    assert "execution_result" in replay and replay["execution_result"] is None
    saved_inputs = torch.load(path / "inputs.pt", weights_only=True)
    saved_state = saved_inputs["arg_1"]
    match = replay["comparison_match"]
    assert match is (not (captured and later_write))
    assert torch.equal(saved_state, before_state + (10 if captured and later_write else 0))
    results.append(
        {
            "captured_predicate": captured,
            "later_write": later_write,
            "original_state": before_state.tolist(),
            "saved_state": saved_state.tolist(),
            "correct_post_x": expected_x.tolist(),
            "replayed_post_x": replay["args"][0].tolist(),
            "comparison_match": match,
            "path": str(path),
        }
    )
    logging.clear_graph_dumps()

logging._restore_cuda_graph_hooks()
report = {"torch": torch.__version__, "scope": "CPU instrumented-capture source module", "cases": results}
(output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
