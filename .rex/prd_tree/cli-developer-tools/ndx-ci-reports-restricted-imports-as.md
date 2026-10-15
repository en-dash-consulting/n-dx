---
id: "0c8c7f53-b63f-4e9c-af2e-c75850d0044e"
level: "task"
title: "`ndx ci` reports restricted imports as \"skipped\" when .n-dx.json is not valid JSON, so configured rules silently stop applying"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
startedAt: "2026-10-15T07:02:37.785Z"
completedAt: "2026-10-15T07:08:51.723Z"
endedAt: "2026-10-15T07:08:51.723Z"
resolutionType: "code-change"
resolutionDetail: "config.js exports loadProjectConfigStrict (returns config + per-file parse errors); checkRestrictedImports fails the step on them. loadProjectConfig unchanged."
acceptanceCriteria:
  - "A project whose .n-dx.json is not valid JSON fails the architecture-policy step, naming the file and the parse error, instead of reporting it skipped (test)"
  - "A project with no config file still reports the step as skipped (test)"
description: "Verdict: should-fix (from the adversarial review of c8fccd87).\n\nScenario: a project has ci.restrictedImports configured, then someone leaves a trailing comma in .n-dx.json. `ndx ci` reports the architecture-policy step as \"skipped (no ci.restrictedImports configured)\" and passes. A file that violates the rule now merges green.\n\nEvidence: packages/core/ci.js checkRestrictedImports reads the rules through loadProjectConfig (packages/core/config.js). That goes through loadOptionalJSON, which catches the parse error and returns {}. The step cannot tell \"absent\" from \"unreadable\".\n\nReachable: any `ndx ci` run with a malformed shared or local config. The parse error that config.js swallows is pre-existing. This change made a CI gate depend on it.\n\nOptions:\n1. Have config.js export a strict reader that reports parse errors with the file label. ci.js fails the step when the file exists but does not parse. Recommended: small, and the config-secrets step could use it too.\n2. Let ci.js parse the raw file itself. This duplicates the layout-aware path lookup.\n\nOperator note (overnight 2026-10-15): Do NOT edit packages/core/cli.js, help.js or command-effects.js, README.md, docs/guide/commands.md, docs/cli-ui-gap.md or tests/setup-session-env.js: another session owns them tonight. If the fix needs one, stop and say so in your summary. Each new test must fail on the code before your change; say how you checked. Run the six static root policy tests before committing. Do not add a changeset. Never use pnpm. Take option 1 (packages/core/config.js gains a strict reader; ci.js uses it). Leave the existing loadProjectConfig behaviour unchanged for every other caller."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-15T07:08:51.990Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
