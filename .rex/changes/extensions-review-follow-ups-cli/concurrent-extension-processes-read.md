---
id: "6e69e53f-cb54-4427-b727-f0dee62e42c9"
type: "task"
title: "Concurrent extension processes read each other's config through one shared NDX_EXTENSION_CONFIG file"
slug: "concurrent-extension-processes-read"
description: "Verdict: must-fix (silent wrong answer). extensionEnvironment (packages/core/extension-env.js:94-99) rewrites the fixed <home>/ext/<name>/ndx-config.json in place for every process. Trigger (run by the reviewer): eight projects each with extensions.recon.who = pN, `ndx recon pN` in parallel: 7 of 8 read another project's config. Every `ndx recon` in a project also overwrites the running hub sidecar's config with that project's merged config, and a reader can catch a truncated file. Reachable: ndx <ext>, ndx extensions sidecar <name>. Fix (recommended): a unique file per process (ndx-config-<pid>-<rand>.json, written tmp+rename, removed when the child closes, stale ones swept), and a separate sidecar-config.json holding user-level config only for sidecars. Inline JSON in the env would change the contract (apiVersion decision)."
acceptanceCriteria:
  - "Two concurrent ndx <ext> runs in different projects each read their own project's merged config"
  - "Running ndx <ext> in a project never changes the config file a running sidecar was started with"
  - "A reader never sees a partially written config file"
  - "A test runs concurrent invocations and fails before the fix"
priority: "critical"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:critical"
source: "ndx-adversarial-review"
---
