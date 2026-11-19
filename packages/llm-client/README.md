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
The codec uses `store: false` with `include: ["reasoning.encrypted_content"]`.
The caller owns tool authorization and execution.

Streaming emits provisional text and one `completed` event containing the final
result. Only that result exposes executable calls. A JSON response or streaming
terminal event with `incomplete_details.reason=max_output_tokens` yields
`stopReason: "max_tokens"`, including an empty or reasoning-only output, with
reported usage retained. Its message carries only visible text: all calls and
opaque reasoning from that turn are discarded to avoid unanswered call IDs.
The caller supplies a continuation prompt. `context.summarize` requests still
reject truncated output. Other incomplete, malformed and failed responses throw. Error objects retain observed token usage;
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
Tests use synthetic API fixtures, not live account/model access. Hench integrates
these methods into its guarded task loop. Its opt-in `llm.autoFailover` chain tries
Codex light, Claude standard, then Claude light, once per selection per run, with
separate credentials and usage attribution. Unsupported OpenAI fallback models
are skipped; refusals, invalid payloads, budget limits and aborts do not fail over.
Hench bounds each OpenAI or Claude attempt in that chain to two minutes plus
`ceil(hench.maxTokens / 10)` seconds, clamped to 10–30 minutes, including response
bodies and primary retries/backoff. Secondary calls have no transport retries.
This policy belongs to Hench; standalone turn callers supply `timeoutMs`.
See [configuration](../../docs/guide/configuration.md) for eligibility and limits.
