"""Two real persisted ADK runners; only model answers are deterministic.

The lookup is read-only. A worker stops before it returns, then a fresh
process resumes the saved parent/child invocation and original tool IDs.
"""
import argparse
import asyncio
import contextlib
import json
import os
from pathlib import Path

import google.adk
from google.adk.agents import LlmAgent
from google.adk.apps import App, ResumabilityConfig
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import DatabaseSessionService
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types


class ContractModel(BaseLlm):
    model: str = "local-lease-contract"
    tool_name: str

    async def generate_content_async(self, llm_request, stream=False):
        responses = [
            part.function_response
            for content in llm_request.contents
            for part in content.parts or []
            if part.function_response and part.function_response.name == self.tool_name
        ]
        if responses:
            part = types.Part(text=json.dumps(responses[-1].response, sort_keys=True))
        else:
            part = types.Part(function_call=types.FunctionCall(
                id="call-" + self.tool_name, name=self.tool_name,
                args={"invoice_id": "inv-42"},
            ))
        yield LlmResponse(content=types.Content(role="model", parts=[part]))


async def main(args):
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    entered = asyncio.Event()
    records = []
    finals = []
    mapping_path = root / "child-map.json"
    parent_path = root / "parent-run.json"
    service = DatabaseSessionService(db_url="sqlite+aiosqlite:///" + str(root / "sessions.db"))

    def record(kind, **data):
        value = {"kind": kind, "pid": os.getpid(), **data}
        records.append(value)
        with (root / (args.phase + "-trace.jsonl")).open("a") as handle:
            handle.write(json.dumps(value) + "\n")

    async def fetch_invoice(invoice_id: str) -> dict:
        """Read an invoice without charging or changing it."""
        record("fetch_entered", invoice_id=invoice_id)
        entered.set()
        if args.phase == "A":
            await asyncio.Event().wait()
        record("fetch_returned", invoice_id=invoice_id)
        return {"invoice_id": invoice_id, "total": "12.50"}

    child_agent = LlmAgent(
        name="invoice_worker", model=ContractModel(tool_name="fetch_invoice"),
        tools=[FunctionTool(fetch_invoice)],
    )
    child = Runner(app=App(
        name="lease_child", root_agent=child_agent,
        resumability_config=ResumabilityConfig(is_resumable=True),
    ), session_service=service)

    async def nested_invoice(invoice_id: str, tool_context: ToolContext) -> dict:
        """Use a durable child invocation keyed by the parent call ID."""
        call_id = tool_context.function_call_id
        assert call_id
        record("parent_tool_entered", call_id=call_id, invoice_id=invoice_id)
        if args.phase == "A":
            await service.create_session(app_name="lease_child", user_id="u", session_id="child-42")
            mapping = {"parent_call_id": call_id, "session_id": "child-42"}
            mapping_path.write_text(json.dumps(mapping))
            inputs = {"new_message": types.Content(role="user", parts=[types.Part(text="Read inv-42")])}
        else:
            mapping = json.loads(mapping_path.read_text())
            assert mapping["parent_call_id"] == call_id
            inputs = {"invocation_id": mapping["invocation_id"]}
        result = None
        async with contextlib.aclosing(child.run_async(
            user_id="u", session_id=mapping["session_id"], **inputs,
        )) as events:
            async for event in events:
                record("child_event", event=event.model_dump(mode="json"))
                if args.phase == "A":
                    mapping["invocation_id"] = event.invocation_id
                    mapping_path.write_text(json.dumps(mapping))
                if event.is_final_response() and event.content:
                    texts = [p.text for p in event.content.parts or [] if p.text]
                    if texts:
                        result = json.loads("".join(texts))
        assert result is not None, "child did not produce its own final result"
        return result

    parent_agent = LlmAgent(
        name="invoice_coordinator", model=ContractModel(tool_name="nested_invoice"),
        tools=[FunctionTool(nested_invoice)],
    )
    parent = Runner(app=App(
        name="lease_parent", root_agent=parent_agent,
        resumability_config=ResumabilityConfig(is_resumable=True),
    ), session_service=service)
    if args.phase == "A":
        await service.create_session(app_name="lease_parent", user_id="u", session_id="parent-42")
        inputs = {"new_message": types.Content(role="user", parts=[types.Part(text="Read inv-42")])}
    else:
        inputs = {"invocation_id": json.loads(parent_path.read_text())["invocation_id"]}
    events = parent.run_async(user_id="u", session_id="parent-42", **inputs)

    async def consume():
        async with contextlib.aclosing(events):
            async for event in events:
                record("parent_event", event=event.model_dump(mode="json"))
                if args.phase == "A":
                    parent_path.write_text(json.dumps({"invocation_id": event.invocation_id}))
                if event.is_final_response() and event.content:
                    texts = [p.text for p in event.content.parts or [] if p.text]
                    if texts:
                        finals.append(json.loads("".join(texts)))

    task = asyncio.create_task(consume())
    close_error = None
    if args.phase == "A":
        await asyncio.wait_for(entered.wait(), timeout=10)
        if args.mode == "active-close":
            try:
                await events.aclose()
            except RuntimeError as error:
                close_error = str(error)
            assert close_error and "already running" in close_error
            task.cancel()  # Release the negative-control worker after the failed close.
        elif args.mode == "private":
            from google.adk.utils._runner_utils import _CALLER_CLOSED_EARLY_MSG
            task.cancel(_CALLER_CLOSED_EARLY_MSG)
        elif args.mode == "detach":
            from google.adk.runners import DETACH_INVOCATION
            task.cancel(DETACH_INVOCATION)
        else:
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    else:
        await asyncio.wait_for(task, timeout=20)

    snapshots = {}
    for name, session_id in [("lease_parent", "parent-42"), ("lease_child", "child-42")]:
        session = await service.get_session(app_name=name, user_id="u", session_id=session_id)
        snapshots[name] = session.model_dump(mode="json")
    result = {
        "phase": args.phase, "mode": args.mode, "pid": os.getpid(), "adk": google.adk.__version__,
        "close_error": close_error, "finals": finals, "records": records, "sessions": snapshots,
    }
    (root / (args.phase + "-result.json")).write_text(json.dumps(result, indent=2))
    counts = {name: sum(e.get("error_code") == "INVOCATION_ABORTED" for e in s["events"])
              for name, s in snapshots.items()}
    print(json.dumps({"phase": args.phase, "mode": args.mode, "pid": os.getpid(),
                      "abort_events": counts, "finals": finals, "close_error": close_error}))
    if args.mode == "detach":
        assert counts == {"lease_parent": 0, "lease_child": 0}, counts
        if args.phase == "B":
            assert finals == [{"invoice_id": "inv-42", "total": "12.50"}], finals
            assert sum(r["kind"] == "fetch_returned" for r in records) == 1
    elif args.phase == "A":
        assert counts["lease_child"] == 1, counts
        assert counts["lease_parent"] == (0 if args.mode == "private" else 1), counts
    else:
        assert finals and "aborted" in str(finals).lower(), finals
        assert not any(r["kind"] == "fetch_returned" for r in records)
    await parent.close()
    await child.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--phase", choices=["A", "B"], required=True)
    parser.add_argument("--mode", choices=["plain", "private", "active-close", "detach"], required=True)
    asyncio.run(main(parser.parse_args()))
