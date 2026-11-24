---
description: "Ephemeral composer side questions that use the chat context without changing the chat."
kind: "package-reference"
---

# @janhq/jan-btw

## Summary

Type `/btw <question>` in an open chat to ask its current model a short question while the main agent keeps working. The answer streams above the composer. The side question and answer do not become messages or change the chat's token meter, title, or notifications.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The web bundle mounts this package with no configuration. Type `/btw <question>` and press Enter, or choose `/btw` from the slash menu and type the question. Copy the answer, close it with Dismiss or Escape, or ask another side question to replace it. Closing or replacing the panel cancels only the side request. A reload clears the panel.

<a id="understand-the-implementation"></a>
## Understand the implementation

The owner-only `btw/ask` Remote takes a chat session identity and question and streams plain text deltas. Its Host counterpart is `ctx.btwRuntime.ask(agent, question, signal)`. It reads the same session surface, request header, and tool history as the agent loop, without entering that loop or appending an event. Like oh-my-pi, it includes any text the main agent is currently streaming. For a chat with no request header yet, it assembles the scoped prompt and tools without logging them. When the last assistant tool batch is incomplete, the side request ends its history before that batch to avoid sending a dangling call. The client registers a free-text command and keeps the answer in its browser Session scope.

<a id="further-exploration"></a>
## Further Exploration

- [Session subsystem](../../../docs/subsystems/session.md) for the conversation surface and request headers.
- [Composer commands](../../client/ui-commands/README.md) for the command input and argument contract.

<a id="model-experience"></a>
## Model Experience

### Side request

#### What the model sees

The request appends one user message to the chat's current prefix. The model receives the chat's tool declarations for cache reuse, but the side request never executes any tool. Only a tool-only response is retried, once, with tool choice disabled.

##### Verbatim side instruction

```markdown
This is an ephemeral side question for the current chat. Answer briefly and directly from the conversation context. Do not use tools or ask follow-up questions.

Question:
```

#### Token effect

The side request adds the instruction and question to its own input only. Its usage is billed by the provider but never enters the main chat's token meter.

#### KV Cache effect

Unlike oh-my-pi, Jan keeps the main call's tool declarations and tool choice on the first side call because dropping them can invalidate a large cached prefix and make a short answer slower and more expensive. The first call also retains the main call's reasoning settings and shared message prefix. It never executes tools. The provider decides whether the prefix hits its cache. A model switch or incomplete final tool batch can shorten the reusable prefix. The side turn changes no main conversation tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A side answer cannot fetch new information through tools.

<a id="dev-note"></a>
### Dev Note

None.
