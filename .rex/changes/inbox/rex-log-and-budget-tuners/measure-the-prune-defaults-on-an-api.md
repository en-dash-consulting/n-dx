---
id: "6e7a53f1-4adf-443f-8937-9647ec7878b9"
type: "task"
title: "Measure the prune defaults on an API-loop batch"
slug: "measure-the-prune-defaults-on-an-api"
description: "The prune trigger/retain defaults (20/10) are still unmeasured. Task 0663c13a confirmed them on arithmetic and documented why the 0.7.1 post-release batch (d08b0479) cannot settle them: DEFAULT_HENCH_CONFIG sets provider \"cli\", and only the API loops construct a ConversationPruner — agent/lifecycle/cli-loop.ts hands the window to the vendor binary — so a batch of default-config ndx work runs fires no prune at all. Its cost totals are evidence about prompt caching and the primer, not about these two numbers. Two further gaps found while confirming: d08b0479 is marked completed but its deliverable docs/analysis/prompt-token-batch-2-results.md was never written and the baseline doc links nothing, so the batch's per-run token classes and cost delta are unrecorded; and no recommendation on the defaults exists anywhere.\n\nImplementation notes: run a batch with hench.provider = \"api\" (the Anthropic loop at agent/lifecycle/loop.ts:1937) on tasks long enough to cross 20 turn-pairs — under the default maxTurns 50 a run prunes at most a few times, so short tasks measure nothing. Capture per-run cache-read vs cache-creation tokens either side of each prune, and the summarizer's own spend, which PruneOutcome.summaryUsage already reports against the context.summarize light tier. The question to answer is whether a wider gap (fewer, larger prunes) or a narrower one pays, measured in cache reads rather than total tokens. Record it in docs/analysis/ and link it from the baseline, then either change DEFAULT_PRUNE_CONFIG in packages/hench/src/schema/v1.ts with a changeset or record the confirmation there. The literal-pinning test in packages/hench/tests/unit/agent/lifecycle/context-prune.test.ts (\"the shipped prune defaults\") and web's mirror in packages/web/src/server/hench-config-fields.ts must move in the same commit; tests/e2e/hench-config-gate-contract.test.js enforces the mirror."
acceptanceCriteria:
  - "A batch run with hench.provider = \"api\" on tasks that cross the prune trigger is recorded in docs/analysis/, with cache-read and cache-creation tokens either side of each prune and the summarizer's own spend."
  - "The document states whether 20/10 holds and why, and is linked from docs/analysis/prompt-token-baseline.md."
  - "If the defaults change, DEFAULT_PRUNE_CONFIG, the literal-pinning test and web's CONFIG_GROUP_DEFAULTS mirror move together, with a changeset naming the upgrade effect."
priority: "low"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "non-code"
source: "Discovered by task 0663c13a while confirming the prune defaults; run 5f2d56ad"
---
