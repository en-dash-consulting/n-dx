---
id: "8b044836-37e2-4f66-8e01-1e80ce1c23bf"
type: "task"
title: "Every writer puts a user's hench.claudePath in .n-dx.local.json"
slug: "every-writer-puts-a-user-s-hench"
description: "Runs in the stack: the claudePath gating that makes this a regression came in with this stack (e1333b3bb), and ac6b536a fixed the same defect for apiKeyEnv. See the change's intent for the scenario.\n\nFix (the change's option 1): add claudePath to llm-client's HENCH_LOCAL_ONLY_SETTINGS and to core's LOCAL_ONLY_SETTINGS.hench, so all three writers (`ndx config hench.claudePath`, `hench config claudePath`, the dashboard's Claude CLI Path field) write .n-dx.local.json. claudePath is optional in the schema, so its neutral value is unset: each writer deletes it from .hench/config.json rather than writing a placeholder. Extend persistConfigChange, setPackageSettingLocally and the dashboard PUT for that, and keep the dashboard's write ordering (local write first, so a failed local write leaves .hench/config.json untouched)."
acceptanceCriteria:
  - "`ndx config hench.claudePath /x/claude` writes .n-dx.local.json hench.claudePath and leaves no claudePath in .hench/config.json; evaluateRepoTrust stays baseline (test)"
  - "`hench config claudePath /x/claude` and the dashboard's Claude CLI Path field write the same local file (one test each)"
  - "Each test fails on the code before the fix"
priority: "medium"
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
