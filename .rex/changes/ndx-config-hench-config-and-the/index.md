---
id: "544298ce-9384-4714-b933-28d7126dca3a"
type: "change"
title: "ndx config, hench config and the dashboard write hench.claudePath to .hench/config.json, where it is ignored until the checkout is trusted"
slug: "ndx-config-hench-config-and-the"
intent: "**Severity:** medium · **Verdict:** out-of-scope (pre-existing; found by the adversarial review of ac6b536a, which fixed the same defect for apiKeyEnv).\n\n**Failure scenario.** A user sets their Claude binary with `ndx config hench.claudePath /opt/claude/bin/claude`, with `hench config claudePath …`, or with the dashboard's \"Claude CLI Path\" field. All three write `.hench/config.json`. packages/core/config.js routes `hench.*` through `handleSetPackageConfig`, and `LOCAL_ONLY_SETTINGS.hench` lists only apiKeyEnv. The hench command is packages/hench/src/cli/commands/config.ts (`persistConfigChange`). The dashboard is packages/web/src/server/routes-hench.ts (`handleConfigUpdate`). A non-bare claudePath there is a `vendor-cli-path` finding (packages/llm-client/src/repo-trust.ts, henchClaudePath in collectRepoExecutionConfig). The checkout becomes untrusted. `applyRepoTrust` (packages/hench/src/store/trust.ts) then drops the value, and `ndx work` also clamps the guard and lowers bypassPermissions until `ndx trust accept .`.\n\n**Reachability.** Documented commands (the `ndx config` help text lists hench.claudePath), `hench config`, and the dashboard settings page.\n\n**Options.** 1 (recommended): add `claudePath` to llm-client's `HENCH_LOCAL_ONLY_SETTINGS` and to core's `LOCAL_ONLY_SETTINGS.hench`. Its neutral value is unset, not a default string: claudePath is optional in the schema, so the writers must delete it from `.hench/config.json` rather than set a neutral value. That needs a small extension to `persistConfigChange`, `setPackageSettingLocally` and the dashboard PUT. Cheap; matches the apiKeyEnv fix. 2: document that users should use cli.claudePath / llm.claude.cli_path instead. Cheapest, but leaves three writers that produce an untrusted checkout."
acceptanceCriteria:
  - "`ndx config hench.claudePath /x/claude` writes .n-dx.local.json hench.claudePath and leaves no claudePath in .hench/config.json; evaluateRepoTrust stays baseline (test)"
  - "`hench config claudePath /x/claude` and the dashboard's Claude CLI Path field write the same local file (one test each)"
  - "Each test fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"ac6b536a-c462-40a2-b5c1-bd2d425ab8a9","run":"5178c0a5-f0ba-44d4-a25b-d26ccc6e8a15"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
