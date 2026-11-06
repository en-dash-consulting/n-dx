---
id: "8b8022ca-0e3a-4aba-8dd1-ab32a6bf1b75"
type: "task"
title: "A change new to the tree keeps its own lastModified as createdAt"
slug: "a-change-new-to-the-tree-keeps-its-own"
description: "PR review comment on #997 (packages/rex/src/store/prd-model-transaction.ts:160): a change that is new to the tree gets createdAt = the transaction stamp even when it arrives with its own lastModified (rex import-bundle, a migration, any caller that keeps provenance), so every imported change reads as 'today' in rex change inbox and on the Inbox rows. Use `node.createdAt ??= node.lastModified ?? stamp.lastModified`. Add a rex test importing a change with an older lastModified. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "An imported change's age comes from its own lastModified (rex test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
