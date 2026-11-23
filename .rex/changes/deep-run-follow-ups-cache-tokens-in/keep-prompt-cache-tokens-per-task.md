---
id: "d842839a-6478-4367-97bc-962252fffa99"
type: "task"
title: "Keep prompt-cache tokens per task class in the analyze run ledger"
slug: "keep-prompt-cache-tokens-per-task"
summary: "Claude calls made through the command-line tool resend a large cached prompt each time, and the run report leaves that out, so a deep run looks far cheaper than it is. Record and price those tokens too."
description: "llm-client already parses both prompt-cache halves into `TokenUsage.cacheCreationInput` / `cacheReadInput`, including from the nested `usage` of the CLI's single result object (fixed in 5ab900a0d). The gap is in sourcevision:\n\n- `src/schema/v1.ts` `LLMClassUsage` has no cache fields. Add optional `cacheCreationTokens` and `cacheReadTokens`, present only when greater than 0, plus matching optional non-negative ints in `src/schema/validate.ts` `LLMClassUsageSchema`.\n- `src/analyzers/run-ledger.ts` `recordLLMCall` adds input and output only. Also add the cache halves into those fields.\n- `priceRunLedger` passes `cacheCreationTokens: 0, cacheReadTokens: 0` to `priceTokens`. Pass the bucket's values, and count them in the \"calls but no tokens\" check. Replace the doc comment's \"today's sourcevision call sites do not use prompt caching\" with the CLI reason.\n- `formatRunLedger` per-class line: append ` + N cached` after \"N tokens\" when the bucket has cache tokens, e.g. `zone.enrich-scan: 2 calls, 3,022 tokens + 48,000 cached, 2.0s (claude claude-haiku-4-5)`.\n- `src/analyzers/token-usage.ts` `formatTokenUsage` (the run's \"N tokens (a in / b out)\" line): append `+ N cached` from `cacheCreationInputTokens + cacheReadInputTokens`, before \"across N LLM calls\". The total stays input+output, because cache tokens are priced apart.\n- llm-client `tests/unit/cli-provider.test.ts`, single-result-object test: add `cache_creation_input_tokens` to the fixture and assert the full `tokenUsage` with `cacheReadInput` and `cacheCreationInput`.\n\nReaders (core run-summary.js, web live-analyze) only see new optional fields, so nothing to change there. Changeset: patch for `@n-dx/sourcevision` (and `@n-dx/llm-client` if its test is the only change there, none needed). Extending the existing `.changeset/deep-run-telemetry.md` is fine."
acceptanceCriteria:
  - "recordLLMCall keeps cacheCreationTokens and cacheReadTokens per bucket, omitted when zero"
  - "priceRunLedger prices cache tokens at the model's cache rates; a test shows the cost rises with cache tokens"
  - "formatRunLedger and formatTokenUsage show '+ N cached' only when there are cache tokens; existing lines are unchanged otherwise"
  - "The manifest validator accepts the new optional fields"
  - "The CLI single-result-object test asserts both cache halves are parsed"
priority: "high"
run: {"tier":"light","skipTestGate":true}
---
