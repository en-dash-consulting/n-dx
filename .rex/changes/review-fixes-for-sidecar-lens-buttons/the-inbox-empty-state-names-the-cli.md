---
id: "055dd1e4-b72d-4f5b-ab63-0b26ecf2b01c"
type: "task"
title: "The Inbox empty state names the CLI through the CLI-name helper"
slug: "the-inbox-empty-state-names-the-cli"
description: "PR 3's full test gate failed tests/unit/viewer/cli-name-labels.test.ts: packages/web/src/viewer/views/inbox.ts:40 hardcodes 'ndx work' in the empty-state text ('A change held in the Inbox cannot close, and ndx work skips its tasks until it is placed.'). Name the CLI through useCliName() (or a {cli} template with resolveCliLabel()) and keep the sentence otherwise the same. Run the cli-name-labels test and the inbox view tests. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "tests/unit/viewer/cli-name-labels.test.ts passes and the empty state still says held changes are skipped (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
