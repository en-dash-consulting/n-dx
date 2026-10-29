---
id: "ac6b536a-c462-40a2-b5c1-bd2d425ab8a9"
type: "task"
title: "ndx config, hench config and the dashboard write a user's hench.apiKeyEnv where it is now ignored until trusted"
slug: "ndx-config-hench-config-and-the"
description: "Adversarial review of task 22fb3f27 (run 992d3d0e), verdict should-fix, severity medium.\n\nFailure scenario: a user runs `ndx config hench.apiKeyEnv MY_ANTHROPIC_KEY`, `hench config apiKeyEnv …` or sets \"API Key Env Var\" in the dashboard. All three write `.hench/config.json` (packages/core/config.js: LOCAL_ONLY_SETTINGS has no hench entry; packages/hench/src/cli/commands/config.ts:625; packages/web/src/server/hench-config-fields.ts:161). Since 2df317261, collectRepoExecutionConfig (packages/llm-client/src/repo-trust.ts ~705) treats a non-default apiKeyEnv from that file as a credential-routing finding. The checkout turns untrusted, and applyRepoTrust (packages/hench/src/store/trust.ts ~108) swaps the value for ANTHROPIC_API_KEY. The user's own setting is ignored and the API run fails with \"API key not found … ANTHROPIC_API_KEY\" until they run `ndx trust accept .`. core/config.js already avoids this for llm.google.apiKeyEnv by routing it to .n-dx.local.json.\n\nReachability: documented commands, the dashboard settings page, and ndx work with provider=api. The failure is fail-safe: no credential leaks, the warning names the field, and trust accept recovers.\n\nOptions:\n1. (recommended) Route hench.apiKeyEnv to .n-dx.local.json in all three writers: in core, add `hench: new Set([\"apiKeyEnv\"])` to LOCAL_ONLY_SETTINGS if hench-section routing is supported there, otherwise extend the routing. Cheap; matches the claudePath and llm.*.apiKeyEnv precedent.\n2. Only document the move to .n-dx.local.json. Cheapest, but leaves three writers producing a config that marks the checkout untrusted."
acceptanceCriteria:
  - "`ndx config hench.apiKeyEnv X` writes .n-dx.local.json, not .hench/config.json, and the checkout stays baseline"
  - "`hench config apiKeyEnv X` and the dashboard's hench apiKeyEnv field write the same local file"
  - "Test: each writer, run in a temp project, leaves evaluateRepoTrust at baseline with apiKeyEnv applied; fails on the code before the fix"
priority: "medium"
tags:
  - "security"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
