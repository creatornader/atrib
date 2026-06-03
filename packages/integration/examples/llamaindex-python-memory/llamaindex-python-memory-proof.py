# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import importlib.metadata
import json
from typing import Any

from llama_index.core.llms import ChatMessage, MessageRole, TextBlock
from llama_index.core.memory import Memory, StaticMemoryBlock

PRIVATE_PHRASE = "quiet LlamaIndex Python memory note"
SESSION_ID = "atrib-llamaindex-python-proof"


def role_value(message: ChatMessage) -> str:
    role = message.role
    return role.value if hasattr(role, "value") else str(role)


def block_to_dict(block: Any) -> dict[str, Any]:
    if hasattr(block, "text"):
        return {"type": "text", "text": block.text}
    return {"type": type(block).__name__}


def message_to_dict(message: ChatMessage) -> dict[str, Any]:
    return {
        "role": role_value(message),
        "content": message.content,
        "blocks": [block_to_dict(block) for block in message.blocks],
    }


def messages_to_dict(messages: list[ChatMessage]) -> list[dict[str, Any]]:
    return [message_to_dict(message) for message in messages]


def append_operation(
    operations: list[dict[str, Any]],
    method: str,
    args: dict[str, Any],
    result: Any,
) -> None:
    operations.append(
        {
            "index": len(operations),
            "method": method,
            "status": "success",
            "args": args,
            "result": result,
        }
    )


def main() -> None:
    static_block = StaticMemoryBlock(
        name="OperatorProfile",
        static_content=[
            TextBlock(text="The operator wants hash-only memory receipts.")
        ],
    )
    memory = Memory.from_defaults(
        session_id=SESSION_ID,
        token_limit=4096,
        memory_blocks=[static_block],
    )

    operations: list[dict[str, Any]] = []

    user_message = ChatMessage(
        role=MessageRole.USER,
        content=f"Remember {PRIVATE_PHRASE} for the atlas order.",
    )
    memory.put(user_message)
    append_operation(
        operations,
        "put",
        {"message": message_to_dict(user_message)},
        {"active_history": messages_to_dict(memory.get_all())},
    )

    assistant_message = ChatMessage(
        role=MessageRole.ASSISTANT,
        content="Saved the atlas order note.",
    )
    memory.put_messages([assistant_message])
    append_operation(
        operations,
        "put_messages",
        {"messages": [message_to_dict(assistant_message)]},
        {"active_history": messages_to_dict(memory.get_all())},
    )

    first_get_input = "What should I remember for the atlas order?"
    first_get = memory.get(input=first_get_input)
    append_operation(
        operations,
        "get",
        {"input": first_get_input},
        {"messages": messages_to_dict(first_get)},
    )

    first_get_all = memory.get_all()
    append_operation(
        operations,
        "get_all",
        {},
        {"messages": messages_to_dict(first_get_all)},
    )

    replacement_message = ChatMessage(
        role=MessageRole.USER,
        content=f"Replace the atlas note with {PRIVATE_PHRASE} and a narrower cue.",
    )
    memory.set([replacement_message])
    append_operation(
        operations,
        "set",
        {"messages": [message_to_dict(replacement_message)]},
        {"active_history": messages_to_dict(memory.get_all())},
    )

    second_get_input = "Which narrower cue matters?"
    second_get = memory.get(input=second_get_input)
    append_operation(
        operations,
        "get",
        {"input": second_get_input},
        {"messages": messages_to_dict(second_get)},
    )

    memory.reset()
    append_operation(
        operations,
        "reset",
        {},
        {"active_history": messages_to_dict(memory.get_all())},
    )

    after_reset = memory.get_all()
    append_operation(
        operations,
        "get_all",
        {"stage": "after_reset"},
        {"messages": messages_to_dict(after_reset)},
    )

    all_operation_material = json.dumps(operations)
    get_material = json.dumps(
        [
            operation
            for operation in operations
            if operation["method"] == "get"
        ]
    )

    print(
        json.dumps(
            {
                "ok": True,
                "llamaindex_version": importlib.metadata.version("llama-index"),
                "memory": {
                    "class": type(memory).__name__,
                    "session_id": memory.session_id,
                    "memory_blocks": [type(block).__name__ for block in memory.memory_blocks],
                    "static_block_names": [block.name for block in memory.memory_blocks],
                },
                "operations": operations,
                "summary": {
                    "operation_count": len(operations),
                    "put_count": sum(
                        operation["method"] == "put" for operation in operations
                    ),
                    "put_messages_count": sum(
                        operation["method"] == "put_messages"
                        for operation in operations
                    ),
                    "get_count": sum(
                        operation["method"] == "get" for operation in operations
                    ),
                    "get_all_count": sum(
                        operation["method"] == "get_all" for operation in operations
                    ),
                    "set_count": sum(
                        operation["method"] == "set" for operation in operations
                    ),
                    "reset_count": sum(
                        operation["method"] == "reset" for operation in operations
                    ),
                    "static_block_returned": "OperatorProfile" in get_material,
                    "private_phrase_in_get_result": PRIVATE_PHRASE in get_material,
                    "private_phrase_in_operations": PRIVATE_PHRASE
                    in all_operation_material,
                    "reset_cleared_active_history": after_reset == [],
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
