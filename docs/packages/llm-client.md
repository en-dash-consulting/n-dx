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
- **Codex adapter** — CLI adapter for OpenAI's Codex models
- **Provider registry** — resolve the configured vendor to the right adapter
- **Token usage tracking** — unified token counting across providers
- **Help formatting** — shared terminal output formatting utilities
- **JSON utilities** — robust JSON extraction and repair for LLM responses

## Vendor Support

| Vendor | API Mode | CLI Mode | Token Accounting |
|--------|----------|----------|-----------------|
| Claude | Yes (recommended) | Yes | Full |
| Codex | No | Yes | Limited (CLI doesn't return usage) |

## Not a Public API

LLM Client is an internal package (`@n-dx/` scoped). Its API surface is consumed exclusively by Rex and Hench through their gateway modules. External consumers should use the n-dx CLI rather than importing this package directly.
