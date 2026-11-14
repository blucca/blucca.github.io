"""Provider-free graph, checkpoint and same-thread continuation controls."""

import argparse
import json
import platform
from collections import Counter
from importlib.metadata import version
from pathlib import Path
from typing import Annotated, Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage, HumanMessage, ToolMessage, messages_to_dict,
)
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import Command, Overwrite
from pydantic import Field

from batch_handoff import batch_handoff, ordered_latest_batch


def violations(messages):
    """Independent request-boundary oracle; no HTTP/provider call is made."""
    errors = []
    for i, message in enumerate(messages):
        if not isinstance(message, AIMessage) or not message.tool_calls:
            continue
        expected = [call["id"] for call in message.tool_calls]
        block = messages[i + 1:i + 1 + len(expected)]
        actual = [m.tool_call_id for m in block if isinstance(m, ToolMessage)]
        if Counter(actual) != Counter(expected):
            errors.append({"expected_adjacent_ids": expected, "actual_adjacent_ids": actual})
    return errors


def outline(messages):
    return [{"type": m.type, "tool_call_id": getattr(m, "tool_call_id", None),
             "tool_calls": [c["id"] for c in getattr(m, "tool_calls", [])],
             "content": m.content} for m in messages]


class TwoParallelCalls(BaseChatModel):
    strict: bool = True
    requests: list[dict[str, Any]] = Field(default_factory=list)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        errors = violations(messages)
        self.requests.append({"messages": outline(messages), "violations": errors})
        if self.strict and errors:
            raise ValueError(f"Local request-boundary contract failed: {errors}")
        if self.strict and any(isinstance(m, ToolMessage) for m in messages):
            assert_complete(messages)
        if not any(isinstance(m, ToolMessage) for m in messages):
            message = AIMessage("", id="fixture-parallel-call", tool_calls=[
                {"name": "look", "args": {"city": "Paris"}, "id": "call_1"},
                {"name": "weather", "args": {"city": "Paris"}, "id": "call_2"},
            ])
        else:
            message = AIMessage("done", id=f"fixture-done-{len(self.requests)}")
        return ChatResult(generations=[ChatGeneration(message=message)])

    def bind_tools(self, tools, **kwargs):
        return self

    @property
    def _llm_type(self):
        return "provider-free-parallel-batch"


def graph(model, counts, saver, fixed, tool_node_class=ToolNode, handoffs=None):
    @tool
    def look(city: str, tool_call_id: Annotated[str, InjectedToolCallId]):
        """Hand back the original report's image-placeholder user message."""
        counts["look"] += 1
        return Command(update={"messages": [
            ToolMessage("image attached", tool_call_id=tool_call_id,
                        id="fixture-look-result"),
            HumanMessage(f"[image of {city}]", id="fixture-image"),
        ]})

    @tool
    def weather(city: str):
        """Get fixture weather, using the ordinary string-return tool API."""
        counts["weather"] += 1
        return f"18C in {city}"

    def handoff(state):
        result = batch_handoff(state)
        if handoffs is not None:
            handoffs.append({"before": messages_to_dict(state["messages"]),
                             "after": messages_to_dict(result["messages"].value)})
        return result

    builder = StateGraph(MessagesState)
    builder.add_node("agent", lambda state: {"messages": [model.invoke(state["messages"])]})
    builder.add_node("tools", tool_node_class([look, weather]))
    builder.add_node("batch_handoff", handoff)
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", tools_condition)
    builder.add_edge("tools", "batch_handoff" if fixed else "agent")
    builder.add_edge("batch_handoff", "agent")
    return builder.compile(checkpointer=saver)


def assert_complete(messages):
    assert not violations(messages)
    replies = [m for m in messages if isinstance(m, ToolMessage)]
    assert Counter(m.tool_call_id for m in replies) == Counter(["call_1", "call_2"])
    assert {m.tool_call_id: m.content for m in replies} == {
        "call_1": "image attached", "call_2": "18C in Paris",
    }
    assert sum(m.id == "fixture-image" and m.content == "[image of Paris]"
               for m in messages) == 1


def assert_payloads_preserved(before, after):
    before_by_id = {m["data"]["id"]: m for m in before}
    after_by_id = {m["data"]["id"]: m for m in after}
    assert len(before_by_id) == len(before)
    assert before_by_id == after_by_id


def existing_pr_class():
    import langgraph.prebuilt.tool_node as stock
    from langchain_core.messages import RemoveMessage, convert_to_messages
    namespace = dict(vars(stock))
    namespace.update(RemoveMessage=RemoveMessage, convert_to_messages=convert_to_messages)
    source = Path(__file__).with_name("existing_pr_9560_method.py")
    exec(compile(source.read_text(), str(source), "exec"), namespace)
    return type("ExistingPR9560ToolNode", (ToolNode,), {
        "_combine_tool_outputs": namespace["_combine_tool_outputs"],
    })


def run():
    initial = {"messages": [HumanMessage("show me Paris", id="fixture-question")]}
    stock_counts = {"look": 0, "weather": 0}
    stock_model = TwoParallelCalls(strict=False)
    saver = InMemorySaver()
    stock_app = graph(stock_model, stock_counts, saver, fixed=False)
    cfg = {"configurable": {"thread_id": "fixture-stock-and-repair"}}
    stock_app.invoke(initial, cfg)
    stock_saved = stock_app.get_state(cfg).values["messages"]
    assert [m.type for m in stock_saved] == ["human", "ai", "tool", "human", "tool", "ai"]
    assert violations(stock_saved) and stock_counts == {"look": 1, "weather": 1}

    stock_model.strict = True
    try:
        stock_app.invoke({"messages": [HumanMessage("confirm saved results",
                                                   id="fixture-followup")]}, cfg)
    except ValueError as error:
        stock_followup_error = str(error)
    else:
        raise AssertionError("Stock checkpoint must fail the strict next-turn contract")
    assert "call_2" in stock_followup_error

    broken = stock_app.get_state(cfg)
    ordered = ordered_latest_batch(broken.values["messages"])
    assert_payloads_preserved(messages_to_dict(broken.values["messages"]),
                              messages_to_dict(ordered))
    repaired_app = graph(stock_model, stock_counts, saver, fixed=True)
    repair_cfg = repaired_app.update_state(
        cfg, {"messages": Overwrite(ordered)}, as_node="batch_handoff",
    )
    repair_snapshot = repaired_app.get_state(repair_cfg)
    assert repair_snapshot.next == ("agent",)
    assert_complete(repair_snapshot.values["messages"])
    assert_payloads_preserved(messages_to_dict(ordered),
                              messages_to_dict(repair_snapshot.values["messages"]))
    repaired_app.invoke(None, repair_cfg)
    assert_complete(repaired_app.get_state(cfg).values["messages"])
    assert stock_counts == {"look": 1, "weather": 1}
    assert not stock_model.requests[-1]["violations"]
    repaired_app.invoke({"messages": [HumanMessage("one more turn",
                                                  id="fixture-repaired-followup")]}, cfg)
    assert_complete(repaired_app.get_state(cfg).values["messages"])
    assert stock_counts == {"look": 1, "weather": 1}

    fixed_counts = {"look": 0, "weather": 0}
    fixed_model = TwoParallelCalls()
    handoffs = []
    fixed_app = graph(fixed_model, fixed_counts, InMemorySaver(), True, handoffs=handoffs)
    fixed_cfg = {"configurable": {"thread_id": "fixture-fixed"}}
    fixed_app.invoke(initial, fixed_cfg)
    fixed_saved = fixed_app.get_state(fixed_cfg).values["messages"]
    assert [m.type for m in fixed_saved] == ["human", "ai", "tool", "tool", "human", "ai"]
    assert_complete(fixed_saved)
    assert_payloads_preserved(handoffs[0]["before"], handoffs[0]["after"])
    handoff_ids = {m["data"]["id"] for m in handoffs[0]["after"]}
    saved_batch = [m for m in messages_to_dict(fixed_saved) if m["data"]["id"] in handoff_ids]
    assert_payloads_preserved(handoffs[0]["after"], saved_batch)
    fixed_app.invoke({"messages": [HumanMessage("confirm saved results",
                                                id="fixture-fixed-followup")]}, fixed_cfg)
    assert_complete(fixed_app.get_state(fixed_cfg).values["messages"])
    assert fixed_counts == {"look": 1, "weather": 1}
    assert all(not request["violations"] for request in fixed_model.requests)

    # Compare the existing closed PR's exact helper, rather than inventing a patch.
    pr_counts = {"look": 0, "weather": 0}
    pr_model = TwoParallelCalls(strict=False)
    pr_app = graph(pr_model, pr_counts, InMemorySaver(), False, existing_pr_class())
    pr_cfg = {"configurable": {"thread_id": "fixture-existing-pr"}}
    pr_app.invoke(initial, pr_cfg)
    pr_saved = pr_app.get_state(pr_cfg).values["messages"]
    assert [m.tool_call_id for m in pr_saved if isinstance(m, ToolMessage)] == ["call_1"]
    assert pr_counts == {"look": 1, "weather": 1} and violations(pr_saved)
    try:
        ordered_latest_batch(pr_saved)
    except ValueError as error:
        missing_result_error = str(error)
    else:
        raise AssertionError("A missing weather result must stop repair")

    return {
        "all_checks_passed": True,
        "runtime": {"python": platform.python_version(), "platform": platform.platform(),
                    **{name: version(name) for name in ["langgraph", "langgraph-prebuilt",
                                                       "langgraph-checkpoint", "langchain-core"]}},
        "scope": "Published SDK; BaseChatModel fixture; no live model or HTTP calls; latest complete local tool batch",
        "stock": {"engine_completed": True, "checkpoint": outline(stock_saved),
                  "next_turn_local_error": stock_followup_error,
                  "model_requests": stock_model.requests[:3]},
        "fixed": {"checkpoint": outline(fixed_saved), "handoff_payloads_preserved": True,
                  "saved_checkpoint_all_message_fields_preserved": True,
                  "model_callback_contents_checked": True,
                  "model_requests": fixed_model.requests, "tool_counts_after_followup": fixed_counts},
        "repair": {"public_update_state_next": list(repair_snapshot.next),
                   "checkpoint_before_resume": outline(repair_snapshot.values["messages"]),
                   "resume_and_next_turn_passed": True, "all_message_fields_preserved": True,
                   "model_requests": stock_model.requests[3:], "tool_counts": stock_counts},
        "existing_pr_9560": {"head": "b573c67d7fa638a37197b1e7e7cefa4963952694",
                             "method_only_comparison": True, "checkpoint": outline(pr_saved),
                             "tools_executed": pr_counts, "missing_result_stops_repair": missing_result_error},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("my-results.json"))
    args = parser.parse_args()
    result = run()
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"all_checks_passed": result["all_checks_passed"], "output": str(args.out)}))
