"""Provider-free native control for JSON tool-return history snapshots."""

import asyncio
from copy import deepcopy
import json
from importlib.metadata import version
import platform

from pydantic_ai import Agent, _tool_execution
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturn, ToolReturnPart
from pydantic_ai.models.function import FunctionModel


async def run_case(mode):
    state = {'order_ids': ['invoice-42']}
    seen = []
    helper_calls = []
    original = _tool_execution.build_tool_return_part

    def snapshot_return(*args, **kwargs):
        part, user_content, tools = original(*args, **kwargs)
        # This control covers ordinary JSON returns, not a generic Any-content fix.
        part.content = deepcopy(part.content)
        helper_calls.append({'tool': part.tool_name, 'call_id': part.tool_call_id})
        return part, user_content, tools

    def model(messages, info):
        for message in messages:
            if isinstance(message, ModelRequest):
                for part in message.parts:
                    if isinstance(part, ToolReturnPart) and part.tool_call_id == 'read-1':
                        seen.append(part.model_response_str())
        turn = sum(isinstance(message, ModelResponse) for message in messages)
        if turn == 0:
            return ModelResponse(parts=[ToolCallPart('read_orders', {}, tool_call_id='read-1')])
        if turn == 1:
            return ModelResponse(parts=[ToolCallPart('append_order', {}, tool_call_id='mutate-2')])
        return ModelResponse(parts=[TextPart('done')])

    agent = Agent(FunctionModel(model))

    @agent.tool_plain
    def read_orders() -> dict[str, list[str]]:
        return deepcopy(state) if mode == 'tool-return' else state

    @agent.tool_plain
    def append_order() -> str:
        state['order_ids'].append('invoice-43')
        return 'ok'

    if mode == 'helper':
        _tool_execution.build_tool_return_part = snapshot_return
    try:
        result = await agent.run('Process the two synthetic orders.')
        history = json.loads(result.all_messages_json())
        saved = [part['content'] for message in history for part in message['parts']
                 if part.get('tool_call_id') == 'read-1' and part.get('part_kind') == 'tool-return']
        assert len(saved) == 1
        agent_helper_calls = helper_calls.copy()
        envelope = None
        if mode == 'helper':
            payload = {'order_ids': ['invoice-42']}
            metadata, user_content, tools = object(), ['Synthetic note'], ['append_order']
            part, returned_content, returned_tools = snapshot_return(
                ToolReturn(return_value=payload, metadata=metadata, content=user_content, tools=tools),
                call=ToolCallPart('read_orders', {}, tool_call_id='envelope-3'), tool_kind=None,
            )
            payload['order_ids'].append('invoice-43')
            envelope = {
                'frozen_json_content': part.content,
                'metadata_same_object': part.metadata is metadata,
                'user_content_same_object': returned_content is user_content,
                'tools_same_object': returned_tools is tools,
            }
        return {
            'agent_output': result.output,
            'model_reads': [json.loads(text) for text in seen],
            'persisted_first_return': saved[0],
            'application_state': state,
            'control_helper_calls': agent_helper_calls,
            'direct_envelope_control': envelope,
        }
    finally:
        _tool_execution.build_tool_return_part = original


async def main():
    stock = await run_case('stock')
    control = await run_case('helper')
    application_copy = await run_case('tool-return')
    expected = {'order_ids': ['invoice-42']}
    final_state = {'order_ids': ['invoice-42', 'invoice-43']}
    report = {
        'python': platform.python_version(),
        'platform': platform.system() + ' ' + platform.machine(),
        'pydantic_ai_slim': version('pydantic-ai-slim'),
        'pydantic': version('pydantic'),
        'scope': 'two sequential JSON-mapping tools: stock, content-only helper control, fresh tool return',
        'stock': stock,
        'snapshot_control': control,
        'application_return_copy': application_copy,
    }
    print(json.dumps(report, indent=2), flush=True)
    assert stock['model_reads'] == [expected, final_state]
    assert stock['persisted_first_return'] == final_state
    for positive in (control, application_copy):
        assert positive['model_reads'] == [expected, expected]
        assert positive['persisted_first_return'] == expected
        assert positive['agent_output'] == stock['agent_output'] == 'done'
        assert positive['application_state'] == stock['application_state'] == final_state
    assert control['control_helper_calls'] == [
        {'tool': 'read_orders', 'call_id': 'read-1'},
        {'tool': 'append_order', 'call_id': 'mutate-2'},
    ]
    assert application_copy['control_helper_calls'] == []
    assert control['direct_envelope_control'] == {
        'frozen_json_content': expected,
        'metadata_same_object': True,
        'user_content_same_object': True,
        'tools_same_object': True,
    }


if __name__ == '__main__':
    asyncio.run(main())
