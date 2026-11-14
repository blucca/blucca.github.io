"""A document questionnaire resumed from JSON by three separate processes.

The second branch deliberately emits its next event with ctx.send_event.
This is an application fixture, not a replacement runtime or core patch.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

from workflows import Context, Workflow, step
from workflows.events import Event, StartEvent, StopEvent, WorkflowIdleEvent
from workflows.plugins import basic_runtime
from workflows.plugins.basic import JournalRecord

ANSWERS = {"vendor:0": "FR", "invoice:0": "1,234.50",
           "vendor:1": "FR12345678901", "invoice:1": "EUR"}


class VendorQuestion(Event):
    number: int


class InvoiceQuestion(Event):
    number: int


class Prompt(Event):
    key: str


class Reply(Event):
    key: str
    text: str


class VendorComplete(Event):
    pass


class InvoiceComplete(Event):
    pass


class DocumentQuestions(Workflow):
    @step
    async def start(self, ctx: Context, ev: StartEvent) -> VendorQuestion | InvoiceQuestion:
        ctx.send_event(InvoiceQuestion(number=0))
        return VendorQuestion(number=0)

    @step
    async def vendor(self, ctx: Context, ev: VendorQuestion) -> VendorQuestion | VendorComplete:
        key = f"vendor:{ev.number}"
        reply = await ctx.wait_for_event(
            Reply, waiter_id=key, waiter_event=Prompt(key=key),
            requirements={"key": key}, timeout=None,
        )
        assert reply.key == key, f"{key} received reply for {reply.key}"
        await ctx.store.set(key, reply.text)
        return VendorQuestion(number=1) if ev.number == 0 else VendorComplete()

    @step
    async def invoice(self, ctx: Context, ev: InvoiceQuestion) -> InvoiceQuestion | InvoiceComplete | None:
        key = f"invoice:{ev.number}"
        reply = await ctx.wait_for_event(
            Reply, waiter_id=key, waiter_event=Prompt(key=key),
            requirements={"key": key}, timeout=None,
        )
        assert reply.key == key, f"{key} received reply for {reply.key}"
        await ctx.store.set(key, reply.text)
        ctx.send_event(InvoiceQuestion(number=1) if ev.number == 0 else InvoiceComplete())
        return None

    @step
    async def finish(self, ctx: Context, ev: VendorComplete | InvoiceComplete) -> StopEvent | None:
        if ctx.collect_events(ev, [VendorComplete, InvoiceComplete]) is None:
            return None
        return StopEvent(result={key: await ctx.store.get(key) for key in ANSWERS})


async def phase(number: int, directory: Path) -> dict:
    assert number in (0, 1, 2)
    directory.mkdir(parents=True, exist_ok=True)
    workflow = DocumentQuestions(timeout=10)
    base = None
    if number:
        payload = json.loads((directory / f"phase-{number - 1}.json").read_text())
        assert payload["phase"] == number - 1
        records = [JournalRecord(**row) for row in payload["records"]]
        # restore owns tick deserialization; record.data is retained unchanged.
        restored = basic_runtime.restore(workflow, payload["base"], records)
        base = {**restored.to_dict(include_state=False), "state": payload["state"]}
        handler = workflow.run(ctx=Context.from_dict(workflow, base))
        for key in payload["prompts"]:
            handler.ctx.send_event(Reply(key=key, text=ANSWERS[key]))
    else:
        handler = workflow.run()

    prompts = []
    async for event in handler.stream_events(expose_internal=True):
        if isinstance(event, Prompt):
            prompts.append(event.key)
        elif isinstance(event, WorkflowIdleEvent) and prompts:
            break
    if number == 2:
        assert prompts == [], prompts
        result = await handler
        assert result == ANSWERS, result
        output = {"phase": number, "pid": os.getpid(), "result": result,
                  "status": "completed", "run_id": handler.run_id}
    else:
        if not prompts:
            await handler  # Surface a failed workflow before checking the expected pause.
        assert set(prompts) == {f"vendor:{number}", f"invoice:{number}"}, prompts
        state = basic_runtime.state_checkpoint(handler.run_id).to_dict()
        await handler.cancel_run()
        try:
            await handler
        except Exception as error:
            assert type(error).__name__ == "WorkflowCancelledByUser", repr(error)
        records = [asdict(record) async for record in basic_runtime.journal(handler.run_id)]
        assert records and all(isinstance(row["data"], str) for row in records)
        output = {"phase": number, "pid": os.getpid(), "base": base,
                  "state": state, "records": records, "prompts": prompts,
                  "status": "saved", "run_id": handler.run_id}
    destination = directory / f"phase-{number}.json"
    destination.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
    assert json.loads(destination.read_text()) == output
    print(json.dumps({key: value for key, value in output.items()
                      if key not in ("base", "state", "records")}), flush=True)
    return output


if __name__ == "__main__":
    assert len(sys.argv) == 3, "Usage: python restart_case.py PHASE OUTPUT_DIRECTORY"
    asyncio.run(phase(int(sys.argv[1]), Path(sys.argv[2]).resolve()))
