# Comparison-only upstream method; MIT, LangChain Inc.
# Source: langchain-ai/langgraph PR #9560, authored by adity982.
# Commit b573c67d7fa638a37197b1e7e7cefa4963952694.
# Verbatim method body; compiled against the installed ToolNode module namespace.
from __future__ import annotations

def _combine_tool_outputs(
        self,
        outputs: list[ToolMessage | Command | list[ToolMessage | Command]],
        input_type: Literal["list", "dict", "tool_calls"],
    ) -> list[Command | list[AnyMessage] | dict[str, list[AnyMessage]]]:
        # Flatten list entries from tools that returned multiple items
        flat_outputs: list[ToolMessage | Command]
        if any(isinstance(output, list) for output in outputs):
            flat_outputs = []
            for output in outputs:
                if isinstance(output, list):
                    flat_outputs.extend(output)
                else:
                    flat_outputs.append(output)
        else:
            flat_outputs = cast("list[ToolMessage | Command]", outputs)

        # preserve existing behavior for non-command tool outputs for backwards
        # compatibility
        if not any(isinstance(output, Command) for output in flat_outputs):
            # TypedDict, pydantic, dataclass, etc. should all be able to load from dict
            return (
                flat_outputs
                if input_type == "list"
                else {self._messages_key: flat_outputs}
            )

        # LangGraph will automatically handle list of Command and non-command node
        # updates
        combined_outputs: list[
            Command | list[AnyMessage] | dict[str, list[AnyMessage]]
        ] = []

        # Tool providers require every result for a parallel call to immediately
        # follow its assistant message. A Command can also add a user or system
        # message; emit those only after all tool results in the batch.
        has_non_tool_messages = False
        for output in flat_outputs:
            if not isinstance(output, Command):
                continue
            if isinstance(output.update, dict):
                messages = convert_to_messages(
                    output.update.get(self._messages_key, [])
                )
            elif isinstance(output.update, list):
                messages = convert_to_messages(output.update)
            else:
                continue
            if any(
                not isinstance(message, (ToolMessage, RemoveMessage))
                for message in messages
            ):
                has_non_tool_messages = True
                break

        tool_messages: list[ToolMessage] = []
        other_messages: list[AnyMessage] = []
        processed_commands: list[Command] = []

        # combine all parent commands with goto into a single parent command
        parent_command: Command | None = None
        for output in flat_outputs:
            if isinstance(output, Command):
                if has_non_tool_messages:
                    if isinstance(output.update, dict):
                        update = cast("dict[str, Any]", output.update)
                        messages = convert_to_messages(
                            update.get(self._messages_key, [])
                        )
                        tool_messages.extend(
                            message
                            for message in messages
                            if isinstance(message, ToolMessage)
                        )
                        retained_messages = [
                            message
                            for message in messages
                            if isinstance(message, RemoveMessage)
                        ]
                        other_messages.extend(
                            message
                            for message in messages
                            if not isinstance(message, (ToolMessage, RemoveMessage))
                        )
                        remaining_update = {
                            key: value
                            for key, value in update.items()
                            if key != self._messages_key
                        }
                        if retained_messages:
                            remaining_update[self._messages_key] = retained_messages
                        elif self._messages_key in update:
                            remaining_update[self._messages_key] = []
                        output = replace(output, update=remaining_update)
                    elif isinstance(output.update, list):
                        messages = convert_to_messages(output.update)
                        tool_messages.extend(
                            message
                            for message in messages
                            if isinstance(message, ToolMessage)
                        )
                        retained_messages = [
                            message
                            for message in messages
                            if isinstance(message, RemoveMessage)
                        ]
                        other_messages.extend(
                            message
                            for message in messages
                            if not isinstance(message, (ToolMessage, RemoveMessage))
                        )
                        output = replace(output, update=retained_messages)

                if (
                    output.graph is Command.PARENT
                    and isinstance(output.goto, list)
                    and all(isinstance(send, Send) for send in output.goto)
                ):
                    if parent_command:
                        parent_command = replace(
                            parent_command,
                            goto=cast("list[Send]", parent_command.goto) + output.goto,
                        )
                    else:
                        parent_command = Command(graph=Command.PARENT, goto=output.goto)
                else:
                    if has_non_tool_messages:
                        processed_commands.append(output)
                    else:
                        combined_outputs.append(output)
            else:
                combined_outputs.append(
                    [output] if input_type == "list" else {self._messages_key: [output]}
                )

        if has_non_tool_messages:
            combined_outputs = []
            if tool_messages:
                combined_outputs.append(
                    tool_messages
                    if input_type == "list"
                    else {self._messages_key: tool_messages}
                )
            combined_outputs.extend(processed_commands)
            if other_messages:
                combined_outputs.append(
                    other_messages
                    if input_type == "list"
                    else {self._messages_key: other_messages}
                )

        if parent_command:
            combined_outputs.append(parent_command)
        return combined_outputs
