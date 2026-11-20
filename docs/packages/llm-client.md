# LLM Client

`@n-dx/llm-client` is the vendor-neutral LLM foundation layer. It provides shared provider interfaces, Claude and Codex adapters, provider registry, and token usage tracking.

## Role in the Architecture

LLM Client sits at the foundation tier — the lowest level of the dependency hierarchy. Both Rex and Hench depend on it for all LLM interactions.

```
  hench → @n-dx/llm-client
  rex   → @n-dx/llm-client
```

## What It Provides

- **Provider interfaces** — abstract types for LLM calls, responses, and token usage
- **Claude adapter** — API and CLI modes for Anthropic's Claude models
- **Codex adapter** — CLI and direct OpenAI API adapters
- **Google adapter** — API adapter for Google's Gemini models
- **Local adapter** — OpenAI-compatible adapter for a local LM Studio / Ollama server
- **Provider registry** — resolve the configured vendor to the right adapter
- **Token usage tracking** — unified token counting across providers
- **Help formatting** — shared terminal output formatting utilities
- **JSON utilities** — robust JSON extraction and repair for LLM responses

## Vendor Support

| Vendor | API Mode | CLI Mode | Token Accounting | Default model |
|--------|----------|----------|-----------------|---------------|
| Claude | Yes (recommended) | Yes | Full | `claude-sonnet-5-5` |
| Codex | Yes | Yes | Request usage on API; reported CLI usage | `gpt-6.1-sol` |
| Google | Yes | No | Full | `gemini-2.5-pro` |
| Local | Yes (OpenAI-compatible) | No | Depends on server | _(whatever is loaded)_ |

Defaults live in `NEWEST_MODELS` / `TIER_MODELS` in `src/config.ts` — that is the
single place to update when a vendor ships a new model.

## OpenAI agent turns

The Responses codec requests `reasoning.encrypted_content` with `store: false`.
JSON and streaming terminal results report output-budget exhaustion as
`max_tokens`, preserving measured usage and only visible text for continuation.
No partial or unanswered function call from that turn is exposed or replayed.
Other incomplete statuses and malformed payloads fail; `context.summarize` still
rejects truncated summaries.

Hench's opt-in `llm.autoFailover` integrates the codec with a once-per-run chain:
Codex light, Claude standard, Claude light. Each attempt, including Claude, gets
two minutes plus `ceil(hench.maxTokens / 10)` seconds, clamped to 10–30 minutes;
body reads and primary retries/backoff share the deadline, secondary calls do not
retry. Aborts take precedence over timeouts and do not switch providers. See
[configuration](../guide/configuration.md#llm-vendor) for eligibility and credentials.

## Not a Public API

LLM Client is an internal package (`@n-dx/` scoped). Its API surface is consumed exclusively by Rex and Hench through their gateway modules. External consumers should use the n-dx CLI rather than importing this package directly.
