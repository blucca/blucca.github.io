"""Run issue #9383's complete purchasing task with three state-ownership controls."""
from __future__ import annotations

import argparse
import copy
from contextlib import redirect_stdout
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import platform
import re
import resource
import sys
from typing import Any

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[name] = "1"

with redirect_stdout(sys.stderr):
    from crewai import Agent
    from crewai.flow import Flow, start
    from crewai.llms.base_llm import BaseLLM
    from crewai.tools import tool
    from crewai.utilities.message_utils import message_content_text
    from pydantic import PrivateAttr

BUDGET_USD = 100
PRICE_USD = 5
REQUESTS = {
    "Marketing": "Buy 8 notebooks and tell me my remaining budget.",
    "Engineering": "Buy 2 notebooks and tell me my remaining budget.",
}


class ObservationLLM(BaseLLM):
    """Keyless ReAct replies; finish only after CrewAI sends the tool observation."""

    _calls: list[dict[str, Any]] = PrivateAttr(default_factory=list)

    def supports_function_calling(self) -> bool:
        # The official AgentExecutor parses the Action and executes the real tool.
        return False

    def get_context_window_size(self) -> int:
        return 8192

    def call(self, messages: Any, **kwargs: Any) -> str:
        contents = [message_content_text(message) for message in messages]
        text = "\n".join(contents)
        request = re.search(r"Buy (\d+) notebooks", text)
        if request is None:
            raise RuntimeError("Purchasing request absent from actual LLM input")
        quantity = int(request.group(1))
        observations = list(re.finditer(r"Observation:\s*Remaining budget: (\d+) USD", text))
        if not self._calls and not observations:
            answer = (
                "Thought: I must buy the requested notebooks using the tool.\n"
                "Action: buy_notebooks\n"
                f'Action Input: {{"quantity": {quantity}}}'
            )
        elif len(self._calls) == 1 and observations:
            remaining = int(observations[-1].group(1))
            answer = (
                "Thought: The purchasing tool returned the remaining budget.\n"
                f"Final Answer: Bought {quantity} notebooks. Remaining budget: {remaining} USD."
            )
        else:
            raise RuntimeError("Expected one real tool observation before Final Answer")
        self._calls.append({
            "call_number": len(self._calls) + 1,
            "message_count": len(messages),
            "message_roles": [message.get("role") for message in messages],
            "last_message_content": contents[-1],
            "tool_observation_received": bool(observations),
            "tool_observations": [match.group(0) for match in observations],
            "response": answer,
        })
        return answer


class DepartmentOrder(Flow):
    _audit: dict[str, Any] = PrivateAttr(default_factory=dict)

    @start()
    def purchase(self):
        tool_calls = []

        @tool
        def buy_notebooks(quantity: int) -> str:
            """Buy notebooks at 5 USD each and return this department's remaining budget.

            Args:
                quantity: Number of notebooks to buy.
            """
            expenses = self.state["wallet"]["expenses"]
            before = list(expenses)
            expense = quantity * PRICE_USD
            expenses.append(expense)
            remaining = BUDGET_USD - sum(expenses)
            observation = f"Remaining budget: {remaining} USD"
            tool_calls.append({
                "name": "buy_notebooks", "quantity": quantity,
                "expense_usd": expense, "expenses_before": before,
                "expenses_after": list(expenses), "remaining_usd": remaining,
                "returned_observation": observation,
            })
            return observation

        llm = ObservationLLM(model="observation-only-notebook-buyer", provider="local-lab")
        buyer = Agent(
            role="Office buyer", goal="Buy requested notebooks and report the budget",
            backstory="Each department starts with its own 100 USD budget.",
            llm=llm, tools=[buy_notebooks], verbose=False, max_iter=3,
        )
        output = buyer.kickoff(self.state["request"])
        self._audit = {
            "llm_calls": copy.deepcopy(llm._calls),
            "llm_call_count": len(llm._calls),
            "tool_calls": tool_calls, "tool_call_count": len(tool_calls),
            "output_type": type(output).__name__, "final_raw": output.raw,
        }
        return output.raw


def snapshot(settings, marketing, engineering):
    return copy.deepcopy({
        "settings": settings,
        "marketing_state": marketing.state,
        "engineering_state": engineering.state,
    })


def expense_tuple(states):
    return tuple(states[key]["wallet"]["expenses"] for key in (
        "settings", "marketing_state", "engineering_state"
    ))


def run_case(mode: str) -> dict[str, Any]:
    settings = {"wallet": {"expenses": []}}
    if mode == "deepcopy":
        marketing = DepartmentOrder(initial_state=copy.deepcopy(settings), tracing=False)
        engineering = DepartmentOrder(initial_state=copy.deepcopy(settings), tracing=False)
    elif mode == "shallow":
        marketing = DepartmentOrder(initial_state=dict(settings), tracing=False)
        engineering = DepartmentOrder(initial_state=dict(settings), tracing=False)
    else:
        marketing = DepartmentOrder(initial_state=settings, tracing=False)
        engineering = DepartmentOrder(initial_state=settings, tracing=False)

    aliases = {
        "flow_state_dict_shared": marketing.state is engineering.state,
        "flow_wallet_shared": marketing.state["wallet"] is engineering.state["wallet"],
        "flow_expense_list_shared": (
            marketing.state["wallet"]["expenses"] is engineering.state["wallet"]["expenses"]
        ),
        "settings_expenses_shared_with_marketing": (
            settings["wallet"]["expenses"] is marketing.state["wallet"]["expenses"]
        ),
    }
    before = snapshot(settings, marketing, engineering)
    m_raw = marketing.kickoff(inputs={"request": REQUESTS["Marketing"]})
    after_marketing = snapshot(settings, marketing, engineering)
    e_raw = engineering.kickoff(inputs={"request": REQUESTS["Engineering"]})
    after_engineering = snapshot(settings, marketing, engineering)

    isolated = mode == "deepcopy"
    expected_after_m = ([], [40], []) if isolated else ([40], [40], [40])
    expected_after_e = ([], [40], [10]) if isolated else ([40, 10], [40, 10], [40, 10])
    expected_e_budget = 90 if isolated else 50
    assert (
        expense_tuple(before), expense_tuple(after_marketing), expense_tuple(after_engineering),
        m_raw, e_raw, list(aliases.values()),
    ) == (
        ([], [], []), expected_after_m, expected_after_e,
        "Bought 8 notebooks. Remaining budget: 60 USD.",
        f"Bought 2 notebooks. Remaining budget: {expected_e_budget} USD.",
        [False, not isolated, not isolated, not isolated],
    ), f"Unexpected complete-task state/output in {mode}"
    for flow, quantity, remaining in ((marketing, 8, 60), (engineering, 2, expected_e_budget)):
        audit = flow._audit
        assert (
            audit["output_type"], audit["llm_call_count"], audit["tool_call_count"],
            [call["tool_observation_received"] for call in audit["llm_calls"]],
            audit["tool_calls"][0]["quantity"], audit["tool_calls"][0]["expense_usd"],
            audit["tool_calls"][0]["remaining_usd"], audit["final_raw"],
        ) == (
            "LiteAgentOutput", 2, 1, [False, True], quantity, quantity * PRICE_USD, remaining,
            f"Bought {quantity} notebooks. Remaining budget: {remaining} USD.",
        ), f"Incomplete native Agent/tool execution in {mode}"
    return {
        "path": mode, "nested_state_isolated": isolated, "aliases_at_construction": aliases,
        "before_runs": before, "after_marketing_before_engineering": after_marketing,
        "after_both_runs": after_engineering,
        "marketing": marketing._audit, "engineering": engineering._audit,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", "--output", dest="out", type=Path, default=Path("observed-results.json"))
    args = parser.parse_args()
    version = metadata.version("crewai")
    assert version == "1.15.39", f"This lab targets formal PyPI crewai==1.15.39, got {version}"
    with redirect_stdout(sys.stderr):
        cases = [run_case(mode) for mode in ("shared", "shallow", "deepcopy")]
    result = {
        "status": "PASS", "source_issue": "https://github.com/crewAIInc/crewAI/issues/9383",
        "environment": {
            "python": platform.python_version(), "platform": platform.platform(),
            "packages": {name: metadata.version(name) for name in (
                "crewai", "crewai-core", "crewai-cli", "pydantic"
            )},
            "llm": "Official BaseLLM subclass; controlled ReAct replies from actual tool observations",
            "provider_calls": 0, "peak_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        },
        "cases": cases,
        "totals": {"flows": 6, "llm_calls": 12, "tool_calls": 6},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("PASS: 3 paths; 6 native Agents; 12 LLM calls; 6 tool calls; deepcopy Marketing=60 USD, Engineering=90 USD.")


if __name__ == "__main__":
    main()
