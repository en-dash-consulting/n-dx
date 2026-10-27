---
id: "1a2f02b9-8a3a-43da-9464-94bc3cdedb1d"
type: "task"
title: "repoCommandEnv drops .hench/config.json guard.env when .n-dx.json has a hench.guard section without env"
slug: "repocommandenv-drops-hench-config-json"
description: "Verdict: should-fix (found reviewing 33ed7463, which moved the pair reviewer's shell test onto repoCommandEnv).\n\nScenario: `.hench/config.json` has `guard.env.deny: [\"MY_DB_URL\"]` (a name the default deny list does not cover) and `.n-dx.json` has `hench.guard: { blockedPaths: [...] }` with no `env`. llm-client `collectRepoExecutionConfig` (packages/llm-client/src/repo-trust.ts ~line 418) folds them with a shallow spread, `{ ...henchConfig, ...projectHench }`, so the `.n-dx.json` `guard` object replaces the hench one whole and `envDeny` is empty. `repoCommandEnv` then passes MY_DB_URL to the test gate, post-task tests, audit, verify_criteria and now the pair reviewer's shell test. core's `loadAllConfigs` uses `deepMerge` for the same files, so `loadShellTestEnv`'s validation compile and `loadVendorCliEnv` see the deny entry while the applied environment does not. Before 33ed7463 the shell test honoured it.\n\nReachable: any repository-command spawn in a checkout whose two configs both carry a `guard` object. Not a widening an untrusted repo can exploit (only repository narrowing is lost), but the user's deny is silently ignored.\n\nOptions:\n1. (Recommended) Deep-merge `guard` (and `guard.env`) in `collectRepoExecutionConfig`, matching core's deepMerge and hench's loader. Cost: the trust digest covers `guard`, so repositories whose merged guard changes read as changed and need re-acceptance; check the digest canonicalisation and decide whether to bump.\n2. Merge only `guard.env` deeply. Smaller digest impact but leaves guard baseline fields inconsistent."
acceptanceCriteria:
  - "With .hench/config.json guard.env.deny naming a sentinel variable and .n-dx.json hench.guard carrying only blockedPaths, repoCommandEnv's result does not contain the sentinel (test asserts presence only)"
  - "runShellTestCommand's child in that fixture does not see the sentinel"
  - "collectRepoExecutionConfig's guard and env fields agree with core loadAllConfigs' merged hench.guard for the same fixture"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
source: "ndx-adversarial-review"
---
