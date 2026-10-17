---
id: "e1684072-9303-4706-821c-bcd524a1cada"
level: "task"
title: "hench's .hench/config.json claudePath and the dashboard's codex --version probe choose a binary while the repository is untrusted"
status: "pending"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
source: "hench-follow-up"
acceptanceCriteria:
  - "An untrusted repository's .hench/config.json claudePath is not spawned by ndx work (test with a sentinel script)"
  - "The dashboard's CLI version probe does not spawn a cli_path or cli.claudePath from an untrusted repository's shared config"
  - "Machine-local settings still apply"
description: "Found while fixing d6282743 (shared `*.cli_path` now applies only once the repository is trusted). Two other readers still let a repository pick a binary n-dx spawns:\n\n1. hench `resolveVendorCliPath` (packages/hench/src/store/project-config.ts) falls back to `henchConfig.claudePath` from `.hench/config.json`, which may be tracked. A cloned repository setting it runs its own script as the Claude CLI on `ndx work` when no `cli_path` is set.\n2. web `resolveBinary` (packages/web/src/server/llm-catalog.ts) reads `llm.codex.cli_path` and `cli.claudePath` raw from the project config and spawns `<binary> --version` for the dashboard's model catalog.\n\nFix direction: route both through the trust gate (`claudePath` into the repo-trust digest/finding, or read it only from machine-local state; web through llm-client's `loadLLMConfig` via its gateway). Tests with a sentinel script that records it ran."
lastModified: "2026-10-17T17:38:14.275Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
