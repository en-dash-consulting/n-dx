---
id: "61a2bc6b-aaf1-4b81-8e6c-2360bbafdf0f"
type: "task"
title: "Plan's lifecycle strip says when an Inbox change is also counted in a stage"
slug: "plan-s-lifecycle-strip-says-when-an"
description: "PR review comment on #997 (packages/web/src/server/routes-rex/product.ts:544) and Ryan's decision: buildChangeSummary counts every isInboxChange in inbox but only awaitsPlacement changes skip the stage tally, so on a tree with no live capability an Inbox change is counted in both (by design: with nowhere to place it, ndx work runs it like any other). Keep the counts. Carry the number of Inbox changes also counted in a stage in the summary wire, and have the strip say so beside the Inbox count, e.g. '1 also in a stage: no capability to place it on yet'. Nothing shows when the number is zero. Add server and viewer tests. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "On a tree with no live capability the strip shows the Inbox count and says the change is also in a stage (viewer test)"
  - "With every Inbox change held, no note shows (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
