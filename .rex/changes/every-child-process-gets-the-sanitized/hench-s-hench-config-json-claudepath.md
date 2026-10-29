---
id: "e1684072-9303-4706-821c-bcd524a1cada"
type: "task"
title: "hench's .hench/config.json claudePath and the dashboard's codex --version probe choose a binary while the repository is untrusted"
slug: "hench-s-hench-config-json-claudepath"
description: "Found while fixing d6282743 (shared `*.cli_path` now applies only once the repository is trusted). Two other readers still let a repository pick a binary n-dx spawns:\n\n1. hench `resolveVendorCliPath` (packages/hench/src/store/project-config.ts) falls back to `henchConfig.claudePath` from `.hench/config.json`, which may be tracked. A cloned repository setting it runs its own script as the Claude CLI on `ndx work` when no `cli_path` is set.\n2. web `resolveBinary` (packages/web/src/server/llm-catalog.ts) reads `llm.codex.cli_path` and `cli.claudePath` raw from the project config and spawns `<binary> --version` for the dashboard's model catalog.\n\nFix direction: route both through the trust gate (`claudePath` into the repo-trust digest/finding, or read it only from machine-local state; web through llm-client's `loadLLMConfig` via its gateway). Tests with a sentinel script that records it ran.\n\nSame class as d6282743 (a repository's shared cli_path picks the spawned binary), whose trust gate this should reuse; Hal's #817 review F1 is this class. Kept in layer 2 by Ryan on 2026-10-27."
acceptanceCriteria:
  - "Closes #635 (follow-up): no binary path a repository ships (hench claudePath, the dashboard's version probe) is spawned while the repository is untrusted"
  - "An untrusted repository's .hench/config.json claudePath is not spawned by ndx work (test with a sentinel script)"
  - "The dashboard's CLI version probe does not spawn a cli_path or cli.claudePath from an untrusted repository's shared config"
  - "Machine-local settings still apply"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
source: "hench-follow-up"
---
