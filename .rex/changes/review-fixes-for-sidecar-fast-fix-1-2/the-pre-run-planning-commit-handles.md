---
id: "6d750811-4a02-4569-9b52-b55d0d0ea6a4"
type: "task"
title: "The pre-run planning commit handles staged renames and deletions of planning files"
slug: "the-pre-run-planning-commit-handles"
description: "PR review comment on #989 (packages/hench/src/agent/lifecycle/shared.ts:2115): PlanningSplit keeps only porcelain's new path. (1) A staged rename `R  .rex/changes/a/state.yaml -> .rex/changes/b/state.yaml` with both sides planning commits b but leaves a's deletion staged, so the run starts on a dirty index and hench's next commit picks it up. (2) A staged deletion after git rm is in neither the worktree nor the index, so `git add -- :(top,literal)…` fails with 'pathspec did not match any files' and the gate refuses the run over n-dx's own files. Carry the rename source through PlanningSplit and add it to the pathspecs, and stage with `git add -A -- <pathspecs>` (or skip add for paths already staged) so deletions work. A rename whose source or target is not a planning path counts as non-planning. Add hench tests for a staged planning rename, a staged planning deletion and a mixed rename. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "A staged planning rename is committed whole and the index is clean afterwards (hench test)"
  - "A staged planning deletion is committed instead of refusing the run (hench test)"
  - "A rename between a planning and a non-planning path refuses as non-planning (hench test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
