# @n-dx/llm-client

> **This is an internal package of [`@n-dx/core`](https://www.npmjs.com/package/@n-dx/core).** Install `@n-dx/core` instead — it includes this package and registers all CLI commands.

Vendor-neutral LLM foundation layer. Provides Claude and Codex adapters, provider registry, token usage tracking, and shared types used across all n-dx packages.

## OpenAI agent turns

`createOpenAiApiProvider()` implements optional `LLMProvider.completeTurn()` and
`streamTurn()` methods for `gpt-6.1-sol` and `gpt-6-astra` (including dated pins).
These use `/responses`; existing `complete()` and `stream()` remain text-only
Chat Completions calls. Check method availability and provider capabilities;
unknown models are rejected by the turn methods rather than guessed from a prefix.
Capabilities describe implementation support, not account access.

Supply `ProviderTurnRequest.messages`, neutral `ToolDefinition` entries, a model,
and optional effort, abort signal and timeout in milliseconds. Append each returned
assistant `message` unchanged, then one `role: "tool"` message per call with its
`toolCallId`, string `content`, and optional `isError`. Include the whole history
on the next turn. Assistant continuation data retains reasoning and is bound to
the original vendor/model; do not log it or send it across provider switches.
The codec uses `store: false`. The caller owns tool authorization and execution.

Streaming emits provisional text and one `completed` event containing the final
result. Only that result exposes executable calls; incomplete, malformed and
failed responses throw instead. Error objects retain observed token usage;
truncated streams label their counters partial. Reasoning tokens remain included
in output totals, and cached input categories are disjoint. User aborts throw
`AbortError`; timeouts are classified separately. Retries are bounded and stop
on abort; streams are never replayed after output has begun.

Only text and function tools are implemented: no vision, hosted tools, async tool
execution or WebSocket steering. Tool schemas explicitly use `strict: false` to
preserve optional fields; callers still validate arguments before execution.
Load configuration through the trust-aware loaders before creating a provider.
The same resolved key and endpoint serve Responses, with redirects disabled and
upstream error bodies excluded from diagnostics. No child process executes here.

Contract verified 2026-11-17 against official [function calling](https://developers.openai.com/api/docs/guides/function-calling),
[reasoning history](https://developers.openai.com/api/docs/guides/reasoning),
[streaming](https://developers.openai.com/api/docs/guides/streaming-responses), and
[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) documentation.
Tests use synthetic API fixtures, not live account/model access. Hench task-loop
integration and failover are separate work.
