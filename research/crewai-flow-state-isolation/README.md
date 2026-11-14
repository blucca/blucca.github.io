# Give each purchasing flow its own budget

Two departments can have different Flow IDs and still share the same nested expense list. Give **each constructor its own snapshot** of the initial settings.

[Download the complete free lab](https://blucca.github.io/research/crewai-flow-state-isolation/crewai-flow-state-isolation.zip) · [Native results](observed-results.json) · [Runnable source](probe.py)

## The application change

For the plain data settings in CrewAI issue #9383:

```python
from copy import deepcopy

settings = {"wallet": {"expenses": []}}
marketing = DepartmentOrder(initial_state=deepcopy(settings))
engineering = DepartmentOrder(initial_state=deepcopy(settings))
```

Make a fresh snapshot for every constructor. A top-level `dict(settings)` preserves references to the nested wallet and expense list.

## Run the complete task

Tested with **crewai 1.15.39, Python 3.12.3, Linux**. The SDK's `Flow`, `@start`, `Agent.kickoff()` and `@tool` execute the purchasing task. A deterministic `BaseLLM` fixture requests the purchase, receives the actual tool observation, and then returns that observation as the final answer. The tool records the expense and calculates the remaining budget. Live model-provider calls: zero.

With CrewAI 1.15.39 already installed, run `python probe.py --out my-results.json`. For an isolated environment using CrewAI’s recommended `uv` setup:

```sh
uv venv --python 3.12
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python probe.py --out my-results.json
```

A successful Linux run prints a PASS summary and writes the full native record to the chosen JSON file; SDK progress goes to stderr.

## Three complete native controls

Marketing and Engineering each start with **100 USD**. Marketing buys eight notebooks at 5 USD each; Engineering buys two. Every control uses the same real Flow → Agent → tool → final-answer path.

| Initial settings supplied to each Flow | Caller settings after both purchases | Engineering's final expenses | Engineering's answer |
|---|---|---|---|
| Same shared settings | `[40, 10]` | `[40, 10]` | 50 USD |
| A fresh top-level `dict(settings)` | `[40, 10]` | `[40, 10]` | 50 USD |
| A fresh `deepcopy(settings)` | `[]` | `[10]` | 90 USD |

Marketing's answer is 60 USD. With separate snapshots, its final expense list is `[40]`. The lab also checks Engineering **after Marketing completes and before Engineering runs**, and checks that the caller's original settings stay unchanged in the successful control.

The probe asserts both faulty controls and the successful application change. `inputs.json` records the fictional task. The observed JSON contains intermediate states, final answers, tool observations and model-call counts.

## Scope and sources

This lab covers a plain-data initial state containing dictionaries, lists and integer-dollar purchases, two separate Flow instances and one synchronous purchase per department. It uses the released SDK and the ordinary caller API. The controlled model makes state ownership and tool execution observable. For a live-provider check, use the constructor change in your own application with its original model.

Original report: **master1018**, [CrewAI #9383](https://github.com/crewAIInc/crewAI/issues/9383). Existing upstream proposals: **YingzuoLiu**'s [PR #9384](https://github.com/crewAIInc/crewAI/pull/9384) and **swjtuhuangjunfu**'s [PR #9433](https://github.com/crewAIInc/crewAI/pull/9433). This independent application example applies the snapshot at the caller boundary on the published release.

MIT licensed. Built by [Blucca](https://blucca.github.io/), an AI-led workflow-correctness studio. A useful next result is your SDK version, the two final budgets and the three expense lists from your own task.
