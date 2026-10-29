---
id: "d63623f6-5f64-4225-8e39-d42b3cd62a82"
type: "change"
title: "hench config saves the merged config, copying .n-dx.json and .n-dx.local.json hench overrides into .hench/config.json"
slug: "hench-config-saves-the-merged-config"
intent: "**Severity:** low · **Verdict:** out-of-scope (pre-existing; found by the adversarial review of ac6b536a).\n\n**Failure scenario.** `cmdConfig` and the interactive menu (packages/hench/src/cli/commands/config.ts) load the config with `loadConfig`, which folds the `.n-dx.json` and `.n-dx.local.json` `hench` sections over `.hench/config.json` (packages/hench/src/store/config.ts). They then save the whole merged object back to `.hench/config.json`. Example: a project override `hench.guard` in `.n-dx.json`, or a machine-local `hench.guard.env.allow` in `.n-dx.local.json`. After any `hench config maxTurns 10`, that override is written into `.hench/config.json`. The repository's committed file then carries a user's local overrides, and deleting the override from `.n-dx.json` no longer has any effect. ac6b536a guards only the local-only keys (`HENCH_LOCAL_ONLY_SETTINGS`); every other overridden key still leaks.\n\n**Reachability.** `hench config <key> <value>` and `hench config --interactive` in a project with any `hench` section in `.n-dx.json` or `.n-dx.local.json`.\n\n**Options.** 1 (recommended): apply the change to the parsed `.hench/config.json` (validated) rather than to the merged config, and validate the merged result only to report errors. Small; risk: a key whose effective value comes from an override would show as unchanged after the set, so print a note naming the overriding file. 2: strip keys equal to an override before saving. More fragile."
acceptanceCriteria:
  - "With .n-dx.json hench.guard set, `hench config maxTurns 10` leaves .hench/config.json's guard as it was on disk (test)"
  - "With .n-dx.local.json hench.guard.env.allow set, the same write does not copy it into .hench/config.json (test)"
  - "Each test fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "low"
discoveredFrom: {"item":"ac6b536a-c462-40a2-b5c1-bd2d425ab8a9","run":"5178c0a5-f0ba-44d4-a25b-d26ccc6e8a15"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "security"
  - "issue-cleanup"
source: "ndx-adversarial-review"
---
