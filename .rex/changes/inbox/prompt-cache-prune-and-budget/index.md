---
id: "fb8de365-e90f-4f24-9f0b-5d5739819487"
type: "change"
title: "Prompt cache, prune and budget configuration"
slug: "prompt-cache-prune-and-budget"
intent: "Three findings from PR #353's adversarial review were left behind when that branch was rebased into #390; they were never on main. Their source is recoverable with `git show 08a93b7f:<path>`, and all three were re-verified live on main on 2026-09-23. The feature also carries the token-budget regression the 0.7.1 audit found in #390's budget change.\n\nThis feature adds hench config keys. The 0.7.1 epic's \"no config key changed\" criterion must be amended to \"additive and optional\" before the release cut."
acceptanceCriteria:
  - "hench exposes promptCache, promptCacheTtl and prune.* config keys, and their defaults leave today's requests and prune cadence unchanged."
  - "A configured token budget no longer trips on Claude CLI cache reads."
plannedRelease: "0.7.1"
priority: "medium"
tags:
  - "0.7.1"
  - "prompt-cache-config"
  - "pr-m"
source: "Recovered #353 adversarial-review findings (08a93b7f) plus the 0.7.1 release audit 2026-09-23"
---
