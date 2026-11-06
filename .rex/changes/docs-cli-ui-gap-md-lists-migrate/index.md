---
id: "c0484f3b-4729-4fb2-9d1e-6781b39d0790"
type: "change"
title: "docs/cli-ui-gap.md lists migrate-layout's hench config rewrite"
slug: "docs-cli-ui-gap-md-lists-migrate"
intent: "PR 1's full test gate failed tests/e2e/cli-ui-gap-drift.test.js: task 3ba44ab7 added a hench config.json write to ndx migrate-layout in packages/core/command-effects.js, but docs/cli-ui-gap.md, which scripts/build-cli-ui-gap.mjs generates from it, was not regenerated. Run node scripts/build-cli-ui-gap.mjs, commit the regenerated page, and confirm cli-ui-gap-drift passes. No code change beyond the generated page."
acceptanceCriteria:
  - "tests/e2e/cli-ui-gap-drift.test.js passes"
touches:
  - "9af68a23-2d1f-4853-90a0-c81f118aaa6c"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":false}
source: "ndx-capture"
---
