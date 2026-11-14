# ADK: keep both invocations resumable during a worker handoff

[Download the complete lab](https://blucca.github.io/research/adk-lease-handoff/adk-lease-handoff.zip) · [Recorded results](https://blucca.github.io/research/adk-lease-handoff/observed-results.json)

A parent agent calls a tool that runs a second, persisted agent. The child reaches its `fetch_invoice` tool and blocks. Worker A then stops. Worker B is a **new Python process**, reads the saved parent/child invocation IDs, and resumes the parent with `invocation_id` and no new message. The child mapping is keyed by the original parent function-call ID.

This lab uses real **google-adk 2.14.1**, `LlmAgent`, `FunctionTool`, asynchronous tasks, and file-backed SQLite sessions. Only the model answers are a deterministic `BaseLlm` fixture. There are zero live model-provider calls. The invoice lookup is read-only and returns `inv-42` / `12.50`; it charges nothing.

## What the native runs show

| Worker A's stop | Parent abort seals | Child abort seals | Worker B's final result |
|---|---:|---:|---|
| Stock plain `task.cancel()` | 1 | 1 | Aborted-call error |
| Stock private early-close message | 0 | 1 | Aborted-call error |
| `aclose()` while `__anext__` is active | Close fails; plain cancel used for cleanup | 1 | Aborted-call error |
| Source proposal, plain `task.cancel()` | 1 | 1 | Aborted-call error |
| Source proposal, explicit detach message | 0 | 0 | `inv-42`, `12.50` |

The active-close error is `aclose(): asynchronous generator is already running`. Worker A waits until the child lookup actually starts, so the test is at the blocking-tool boundary. Closing the stream immediately after the first function-call event can stop **before** that tool starts; it exercises a different boundary.

## Run the whole lab

Start in a fresh, writable copy with an isolated environment. Tested on Python 3.12.3 / Linux.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
.venv/bin/python run_lab.py
```

The complete run first checks three stock stop policies, then applies the two-file source proposal **inside that isolated environment**, and checks both normal cancellation and explicit detach. Each A/B phase is a separate process. It leaves the SQLite sessions, original runtime files, phase traces, logs and results under this lab directory. `native-state.json` records the last completed step.

`requirements.lock.txt` is the actual dependency set used for these native runs; `requirements.txt` records the top-level package selection. For another version, compare its lifecycle and rerun the same acceptance checks.

## The two-file source proposal

This is an **experimental source proposal for 2.14.1**. `DETACH_INVOCATION` is the proposed public export introduced by `patch_runtime.py`.

```python
from google.adk.runners import DETACH_INVOCATION  # supplied by this proposal

worker_task.cancel(DETACH_INVOCATION)
# In the fresh worker:
async for event in runner.run_async(
    user_id=user_id, session_id=session_id, invocation_id=saved_invocation_id,
):
    ...
```

The proposed export reuses the existing early-close cancellation value. The node event loop carries the cancellation message through `Runner._cleanup_root_task` to the root node's `Task.cancel(message)`. That preserves the detach reason when a root tool awaits a nested runner. `GeneratorExit` is mapped to the same early-close reason. Ordinary cancellation retains the original abort seals.

The helper verifies the installed 2.14.1 version and exact source contexts before changing two files. It emits `detach-proposal.patch` and keeps their originals. `probe.py` is the full parent → tool → persisted child → blocking lookup → fresh-process resume example.

### Application scope

The measured scope is one persisted parent, one persisted child, one ordinary read-only lookup, and a controlled stop before that lookup returns. The successful run retains exactly one original call in each session, completes the lookup once in worker B, and produces the child's own result. A production tool that has already committed an external effect needs its own replay contract; ADK's documented resumption is at-least-once.

A public `LongRunningFunctionTool` plus an external durable worker can also separate job ownership from the parent task. That requires the application to dispatch and return a waiting result rather than keep a blocking nested invocation inside the parent tool. A falsy long-running return keeps its function call unanswered; a truthy ticket supplies its result immediately. Keep the durable child mapping in the application's own storage.

## Source and attribution

- Original request: [markwang-obin, ADK #8130](https://github.com/google/adk-python/issues/8130).
- Google ADK source is Apache-2.0; the patch excerpts retain that license. See `LICENSE.google-adk`.
- The synthetic invoice fixture, process harness and recorded native controls were built by Blucca with OpenAI Codex. See `LICENSE` for this lab's code.
- Upstream PR direction and assignment are handled in the original issue before a core contribution.

## Your own handoff

Keep your SDK version, both saved invocations, the parent-to-child call mapping, and the expected tool result together. Run normal-abort and detach controls against that same task. Send the version and the resulting state/trace when you want help with the recovery contract.
