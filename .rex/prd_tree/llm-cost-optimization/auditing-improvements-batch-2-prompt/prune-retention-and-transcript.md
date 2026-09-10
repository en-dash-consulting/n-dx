---
id: "163f90b1-7c43-4b91-a9c7-74327b3222ec"
level: "task"
title: "Prune retention and transcript truncation are hard-coded, halving the verbatim window and summarizing from 800-char excerpts"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "hench"
  - "context-prune"
  - "config"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`ConversationPruner` accepts `{ triggerPairs, retainPairs, transcriptMessageChars, transcriptChars }` options; the exported constants remain as defaults and existing tests pass unchanged"
  - "hench config schema accepts `prune.triggerPairs`, `prune.retainPairs`, `prune.transcriptMessageChars`; validation rejects `retainPairs >= triggerPairs` and values below 2 with an actionable error"
  - "All three API loops construct the pruner from the resolved config"
  - "Default per-message transcript cap is 2,000 characters and the overall cap is 40,000; a test shows a 22-message span of 2,000-char tool results is not truncated"
  - "A unit test proves a custom `retainPairs` changes the retained tail length"
  - "Config documentation lists the three new keys with the defaults and the trade-off"
description: "Severity: low. Verdict: should-fix (user elected to address). Found by the adversarial review of PR #353.\n\n## Observation\nBefore PR #353 the loop always kept the most recent 20 pairs verbatim. `PRUNE_RETAIN_PAIRS = 10` (packages/hench/src/agent/lifecycle/context-prune.ts:78) means that from turn 22 onward the agent has half the verbatim history it used to, and `TRANSCRIPT_MESSAGE_CHAR_LIMIT = 800` (context-prune.ts:84) truncates each dropped message to 800 characters before the light model sees it, so a 2,000-character tool result loses 60% before summarization. The summary itself is capped at 1,600 characters. The PR's claim that nothing learned is lost is bounded by those caps, and the summary is injected as a user message the main model treats as fact. None of this is a defect; it is a tuning surface with no knobs and no visibility.\n\n## Reachability\nEvery run past 21 turns on the three API loops.\n\n## Solution options\n1. (Recommended) Make the limits constructor options on `ConversationPruner` with the current constants as defaults, expose them as `hench.prune.triggerPairs`, `hench.prune.retainPairs` and `hench.prune.transcriptMessageChars` in the hench config schema with validation (retain < trigger, both >= 2), and raise the default per-message transcript cap to 2,000 characters (matching `MAX_TOOL_OUTPUT_STORED`) with the overall transcript cap raised to 40,000 so a full 22-message span fits. Keep 20/10 as the pair defaults so the cache cadence is unchanged. Cost: small. Risk: a larger summarizer prompt (about 10K tokens on the light tier per prune).\n2. Raise `PRUNE_RETAIN_PAIRS` to 15 with no configuration. Halves the append-only window between prunes and doubles cache resets; not recommended without measurement.\n\nOption 1 lets each project tune the trade-off and makes the effect measurable via the existing `detail` prune log line."
lastModified: "2026-09-07T20:28:45.858Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
