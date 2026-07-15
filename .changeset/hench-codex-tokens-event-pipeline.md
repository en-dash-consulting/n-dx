---
"@n-dx/hench": patch
---

Wire Codex text-format token accounting into the event-pipeline close path. When `config.useEventPipeline` was enabled, the two non-JSON `catch` blocks in `spawnWithAdapter`'s close handler were empty, unlike the legacy path which falls back to `parseCodexCliTokenUsage`. Because `codex --json` emits JSONL, `JSON.parse(fullStdout)` always throws, so enabling the event pipeline silently zeroed Codex token/credit accounting. Both catch blocks now recover token usage from the text-format summary line and push a `token_usage` event into the accumulator.
