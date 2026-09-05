---
id: "3dbeb973-a012-435b-8941-3bfc22b7ef96"
level: "task"
title: "Prompt caching in the API agent loop (cache_control breakpoints)"
status: "completed"
priority: "high"
startedAt: "2026-09-04T18:38:54.994Z"
completedAt: "2026-09-04T19:07:40.436Z"
endedAt: "2026-09-04T19:07:40.436Z"
acceptanceCriteria:
  - "The Anthropic API request carries a cache_control ephemeral breakpoint covering the stable prefix (system prompt plus TOOL_DEFINITIONS)"
  - "A second breakpoint marks the trailing conversation boundary so each turn extends a cached prefix rather than re-sending it"
  - "cache_creation_input_tokens and cache_read_input_tokens are recorded in the run's token usage and surfaced by ndx usage"
  - "Non-Anthropic providers (codex, google, local) are unaffected and take no new code path"
  - "A unit test asserts the request body carries breakpoints and that a second turn reuses the same prefix bytes"
description: "packages/hench/src/agent/lifecycle/loop.ts sends system prompt, TOOL_DEFINITIONS and the full message history on every turn with no cache_control. Add ephemeral cache breakpoints on the stable prefix (system + tools) and on the trailing conversation boundary so repeated turns read from cache instead of re-sending. Anthropic API path only; the CLI path already reuses sessions via --resume/--fork-session."
lastModified: "2026-09-04T19:07:40.445Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
