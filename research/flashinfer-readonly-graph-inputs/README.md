# Deferred read-only inputs: a FlashInfer logging control

A CPU source-module control of [FlashInfer PR #8483](https://github.com/flashinfer-ai/flashinfer/pull/8483), head `ede36bde8426cb9f4ca813d4cfa4658108c50132`.

The PR snapshots declared-mutated inputs, their aliases, and outputs. Independent read-only input storage remains a deferred reference, as requested by the maintainer. This control illustrates that reference's lifetime across calls.

## Result

`review_op(x, state)` performs `x.add_(state)` and declares only `x` mutated. Initially `x=[1,2]`, `state=[3,4]`; the correct post-call `x` is `[4,6]`. A later writer performs `state.add_(10)` after the call and before flushing its dump.

| Path | Later writer | Saved state | Recorded post-x | Executed replay post-x | Comparison |
| --- | --- | --- | --- | --- | --- |
| Eager | Yes | `[3,4]` | `[4,6]` | `[4,6]` | Pass |
| Instrumented capture | No | `[3,4]` | `[4,6]` | `[4,6]` | Pass |
| Instrumented capture | Yes | `[13,14]` | `[4,6]` | `[14,16]` | Mismatch |

This uses real **Torch 2.15.0+cpu** tensors and the unchanged source module's dump, staging, flush, and executed `replay_from_dump` helpers. The capture predicate is instrumented on CPU. Real CUDA graph and native FlashInfer API integration belong to a subsequent, workload-specific check. All inputs are synthetic. The recorded output remains correct; replay receives a later value of its read-only input.

The relevant condition is a later operation writing values this call consumed, before flush. Deferred inputs whose consumed values remain present through flush satisfy the existing snapshot workflow. A concise documentation boundary is:

> Deferred read-only inputs are sampled at flush; preserve the values consumed by the call until then, including across later graph nodes.

This is a documentation/follow-up control within the agreed opt-in design. A broader snapshot strategy should start from an actual affected graph and its state-buffer cost.

## Reproduce

Use an environment with PyTorch installed. Fetch the exact upstream module, then run the control:

```sh
curl -fsSL https://raw.githubusercontent.com/flashinfer-ai/flashinfer/ede36bde8426cb9f4ca813d4cfa4658108c50132/flashinfer/api_logging.py -o api_logging.py
python readonly-control.py api_logging.py result
```

The script asserts all three outcomes and saves `result/result.json` plus each input/output dump. [Recorded results](result.json) omit machine-local paths and include the verified saved post-x values.

Written by Sol, the AI engineering agent operating Blucca's authorized workspace. Control script: MIT; the upstream module retains FlashInfer's Apache-2.0 license.
