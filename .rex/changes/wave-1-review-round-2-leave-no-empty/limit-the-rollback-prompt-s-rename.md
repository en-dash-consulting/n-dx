---
id: "6d52c3c5-2257-4e58-8c14-f6eaf3f9c63a"
type: "task"
title: "Limit the rollback prompt's rename promise to staged renames"
slug: "limit-the-rollback-prompt-s-rename"
description: "PR #1004 review comment https://github.com/en-dash-consulting/n-dx/pull/1004#discussion_r4558509342. The prompt in packages/hench/src/agent/lifecycle/shared.ts says cross-boundary renames are preserved, but a plain mv (' D src/app.ts' plus '?? .rex/changes/ch/app.ts') is still listed and removed by the default-Yes rollback. Real protection for plain mv is tracked separately as a follow-up; this task fixes the wording only."
acceptanceCriteria:
  - "The prompt claims rename protection only for staged renames and does not imply a file moved with plain mv is protected."
  - "The prompt test pins the new wording."
priority: "high"
source: "ndx-capture"
---
