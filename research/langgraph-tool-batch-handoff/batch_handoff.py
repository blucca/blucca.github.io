"""A complete, local ToolNode batch, written once before the next model node.

Scope: the latest AI tool batch, local Command updates, one sequential handoff.
Parent routing, interrupts and missing tool results need their own contracts.
"""

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.types import Overwrite


def ordered_latest_batch(messages):
    """Keep every message and field; move the latest batch's replies together."""
    pivot = next(
        (i for i in range(len(messages) - 1, -1, -1)
         if isinstance(messages[i], AIMessage) and messages[i].tool_calls),
        None,
    )
    if pivot is None:
        raise ValueError("Expected a completed AI tool-call batch")

    expected = [call["id"] for call in messages[pivot].tool_calls]
    if len(set(expected)) != len(expected):
        raise ValueError("Tool-call IDs must be distinct")
    replies = {}
    other = []
    for message in messages[pivot + 1:]:
        if isinstance(message, ToolMessage):
            if message.tool_call_id in replies:
                raise ValueError(f"Duplicate tool result: {message.tool_call_id}")
            replies[message.tool_call_id] = message
        else:
            other.append(message)
    if set(replies) != set(expected):
        raise ValueError(
            f"Incomplete batch: expected {expected}, received {list(replies)}"
        )
    return messages[:pivot + 1] + [replies[call_id] for call_id in expected] + other


def batch_handoff(state):
    # add_messages merges IDs in their old positions. Overwrite also saves order.
    return {"messages": Overwrite(ordered_latest_batch(state["messages"]))}
