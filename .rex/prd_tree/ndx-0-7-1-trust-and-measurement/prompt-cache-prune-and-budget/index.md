---
id: "fb8de365-e90f-4f24-9f0b-5d5739819487"
level: "feature"
title: "Prompt cache, prune and budget configuration"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "prompt-cache-config"
  - "pr-m"
source: "Recovered #353 adversarial-review findings (08a93b7f) plus the 0.7.1 release audit 2026-09-23"
acceptanceCriteria:
  - "hench exposes promptCache, promptCacheTtl and prune.* config keys, and their defaults leave today's requests and prune cadence unchanged."
  - "A configured token budget no longer trips on Claude CLI cache reads."
description: "Three findings from PR #353's adversarial review were left behind when that branch was rebased into #390; they were never on main. Their source is recoverable with `git show 08a93b7f:<path>`, and all three were re-verified live on main on 2026-09-23. The feature also carries the token-budget regression the 0.7.1 audit found in #390's budget change.\n\nThis feature adds hench config keys. The 0.7.1 epic's \"no config key changed\" criterion must be amended to \"additive and optional\" before the release cut."
lastModified: "2026-09-23T18:40:23.451Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [No way to disable cache_control breakpoints for a Claude api_endpoint that rejects them](./no-way-to-disable-cache-control.md) | completed |
| [Prompt cache TTL is fixed at 5 minutes, so tool calls longer than about 4 minutes rewrite the whole conversation at the cache-write price](./prompt-cache-ttl-is-fixed-at-5-minutes.md) | pending |
| [Prune retention and transcript truncation are hard-coded, halving the verbatim window and summarizing from 800-char excerpts](./prune-retention-and-transcript.md) | pending |
| [Stop Claude CLI cache reads from tripping hench.tokenBudget](./stop-claude-cli-cache-reads-from.md) | completed |
