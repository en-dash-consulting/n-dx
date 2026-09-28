---
id: "790bef82-3eac-43b4-8300-b549128258aa"
level: "feature"
title: "rex log and budget tuners"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
source: "caos work management: feature ndx 0.8.0 - rex log and budget tuners"
acceptanceCriteria:
  - "rex log writes the same entry append_log would, and the hench workflow uses it when MCP is absent."
  - "Both tuners measure run cost through one helper shared with checkTokenBudget, and neither proposes a tokenBudget below the measured context-write floor."
  - "A test feeds recorded prompt-cached run profiles and asserts the tuners' proposals are in the budget's units."
  - "The prune defaults are confirmed or changed, with the measurement batch cited in the changeset."
  - "Upgrading with no config change alters no run behaviour."
description: "Most of what this feature first planned shipped early, in 0.7.1. #406 made the prompt-cache switch (promptCache), its TTL (promptCacheTtl) and prune retention and transcript truncation (hench.prune.*) configurable with today's values as defaults, and fixed the token budget so Claude CLI cache reads no longer trip it. #412 stamped the primer with a content fingerprint, so an analysis run without an LLM keeps a primer that is still correct.\n\nThree pieces remain. First, add a rex log CLI command so the append_log workflow step works when no MCP server is reachable; every run in the last measured batch failed that step (rex task db878e62). Second, make the adaptive and workflow tuners measure run cost in the same token classes as checkTokenBudget. Today totalTokens() in packages/hench/src/agent/analysis/adaptive.ts and workflow.ts counts input plus output, roughly 11x lower than the budget's count on a prompt-cached run, so against the 600K template budgets the adaptive tuner would propose a tokenBudget near 125K, below the roughly 190K initial context write, and every later run would fail on arrival. Nothing shipped calls the tuners yet, so the exposure today is to library consumers. Third, set the prune defaults (20 turn-pairs trigger, 10 retained) from the 0.7.1 post-release measurement batch instead of leaving them at the values that were hard-coded before.\n\nGoal: Every workflow step is possible from the CLI alone, and anything that proposes or enforces a token budget measures cost the same way."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [append_log is MCP-only — no CLI equivalent, so ndx work runs cannot write execution-log entries](./append-log-is-mcp-only-no-cli.md) | completed |
| [Close the two should-fix gaps the 114c4bc8 review dropped: vacuous floor test and non-cached high-usage threshold](./close-the-two-should-fix-gaps-the.md) | pending |
| [Fix the dashboard's duplicate tuners, which auto-apply a token budget below the arrival cost](./fix-the-dashboard-s-duplicate-tuners.md) | pending |
| [Make the adaptive and workflow tuners measure run cost in the same token classes as checkTokenBudget](./make-the-adaptive-and-workflow-tuners.md) | completed |
| [Set the prune defaults from the 0.7.1 post-release measurement batch](./set-the-prune-defaults-from-the-0-7-1.md) | pending |
