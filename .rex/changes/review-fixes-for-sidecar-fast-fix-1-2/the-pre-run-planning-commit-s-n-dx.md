---
id: "6ea32693-0356-466a-9a3e-696a101f2819"
type: "task"
title: "The pre-run planning commit's N-DX-Item trailer names the resolved task id, not --task as typed"
slug: "the-pre-run-planning-commit-s-n-dx"
description: "PR review comment on #989 (packages/hench/src/cli/commands/run.ts:2393): the planning commit's N-DX-Item takes --task as typed. On v2, --task accepts a display id (CH-12), an alias or a change id that resolves to one of its tasks (findV2Entry; see run-resolve.ts), so the trailer can name something other than the canonical id that restacks and landing key on. Resolve the ref to the unit hench will run before the pre-run gate and pass that id; when no canonical id is known, leave the trailer out rather than write a non-canonical one. Add hench tests for a display id and a change ref. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "--task given as a display id or a change ref writes the resolved task's id in the planning commit's N-DX-Item (hench test)"
  - "Without a resolvable id the planning commit has no N-DX-Item (hench test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
