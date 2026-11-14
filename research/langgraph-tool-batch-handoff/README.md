# Keep a LangGraph tool batch complete

**Put every tool reply together, save the checkpoint, and continue the same thread.**

This free, provider-free lab uses the original `look` Command + ordinary `weather` example from [Iraavanan’s LangGraph #9556](https://github.com/langchain-ai/langgraph/issues/9556). It preserves the two reply payloads and the image-placeholder message through the real graph and checkpoint store.

[Download the complete lab](https://blucca.github.io/research/langgraph-tool-batch-handoff/langgraph-tool-batch-handoff.zip) · [Recorded results](observed-results.json) · [Application helper](batch_handoff.py)

## Recorded native results

Linux x86-64, Python **3.14.8**, `langgraph 1.2.19`, `langgraph-prebuilt 1.1.1`, `langgraph-checkpoint 4.3.1`, `langchain-core 1.7.4`. All model responses come from a local `BaseChatModel` fixture. Ten real model callbacks and six tool executions per complete probe; zero live model-provider calls.

| Path | Saved replies after the AI’s two calls | Result |
|---|---|---|
| Published stock `ToolNode` | `call_1 → image → call_2` | Graph completes; a strict next-turn message contract fails |
| Existing Python PR #9560 helper | `call_1 → image` | Weather executes, but its `call_2` reply is lost |
| Public `Overwrite` handoff | `call_1 → call_2 → image` | Model input and saved checkpoint pass |
| Repair the original stock checkpoint | `call_1 → call_2 → image` | Public `update_state`, resume and another turn pass |

The fixed and repaired paths preserve every original message field and ID in the actual saved checkpoint. The strict model callback independently checks adjacent call IDs, both tool texts and the image placeholder. On the same thread’s next turn, `look` and `weather` remain at **one execution each**.

The provider 400/200 results are the original author’s measurements. This lab checks the real SDK’s message order, contents and persistence using a local request-boundary oracle.

## Run it

Extract the ZIP into a new directory. Create a virtual environment with your Python 3.12+ interpreter:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.lock.txt
python probe.py --out my-results.json
```

On Windows, run `.venv\Scripts\python.exe -m pip install -r requirements.lock.txt` and `.venv\Scripts\python.exe probe.py --out my-results.json`. The recorded native run is the Linux/Python 3.14.8 configuration above.

Completion: exit **0** and `all_checks_passed: true`. The probe asserts the faulty stock and existing-PR controls as well as the successful handoff and recovery. It also checks that a missing `call_2` stops recovery.

## Use the application helper

Keep the original tools. Add one sequential node **between the complete ToolNode batch and the next model node**:

```python
from batch_handoff import batch_handoff

g.add_node("batch_handoff", batch_handoff)
# Replace the original tools -> agent edge with:
g.add_edge("tools", "batch_handoff")
g.add_edge("batch_handoff", "agent")
```

`ordered_latest_batch` finds the latest AI message’s call IDs, requires exactly one result for each, and creates a new complete history. It preserves the original prefix and keeps the remaining messages in their relative order. `Overwrite` writes that order through the public message channel; a normal `add_messages` update retains existing message positions.

For an already saved, complete last batch, compile the updated graph with the **same checkpoint store and thread configuration**:

```python
from batch_handoff import ordered_latest_batch
from langgraph.types import Overwrite

snapshot = app.get_state(cfg)
restored_cfg = app.update_state(
    cfg,
    {"messages": Overwrite(ordered_latest_batch(snapshot.values["messages"]))},
    as_node="batch_handoff",
)
app.invoke(None, restored_cfg)
```

`as_node` refers to the actual node whose outgoing edge leads to your model. The probe verifies `next == ("agent",)` before resuming. It retains the saved follow-up message and uses the resumed model response to finish that turn.

Scope: one local `ToolNode`, a complete normal batch, a sequential handoff, and the latest damaged batch. The original fixture’s image is a textual placeholder. Parent routing, explicit `goto`, interrupts, image decoding and live provider behavior have their own acceptance cases. A missing or duplicate result stops the helper; supply the complete batch before recovery.

## Sources and reuse

- Original report and self-contained graph: **Iraavanan**, [#9556](https://github.com/langchain-ai/langgraph/issues/9556).
- Existing Python helper: **adity982**, [PR #9560](https://github.com/langchain-ai/langgraph/pull/9560), frozen commit `b573c67d7fa638a37197b1e7e7cefa4963952694`. `existing_pr_9560_method.py` is its exact method, executed in an isolated subclass against the published SDK. Its source mapping is included.
- Directly paired JavaScript work: [PR #3192](https://github.com/langchain-ai/langgraphjs/pull/3192). The inspected latest JS branch includes ordinary tool results; this lab measures the frozen Python helper above.
- Upstream method retains LangChain’s MIT notice in `LICENSE.langgraph`. Our application helper and native probe are MIT.

Built and run by **Blucca’s Codex AI agent**; a separate Codex reviewer reran the complete probe.

Have this failure in your own saved thread? [Send your SDK version and a small redacted expected/actual case](mailto:belgialucca@gmail.com?subject=LangGraph%20tool%20batch%20case). Include `my-results.json` if you ran the lab. A repair starts with an agreed scope, acceptance case, budget and date.
