---
id: "2c480d36-480d-479b-b896-dd8ca42aac38"
level: "task"
title: "tree-diff product map section, --format=markdown and --out are missing from docs/packages/rex.md and have no changeset"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-18"
source: "ndx-adversarial-review"
startedAt: "2026-10-09T07:54:02.354Z"
completedAt: "2026-10-09T07:54:02.354Z"
endedAt: "2026-10-09T07:54:02.354Z"
resolutionType: "code-change"
resolutionDetail: "docs/packages/rex.md tree-diff entry and .changeset/tree-diff-product-map-markdown.md (@n-dx/rex patch), landed with 523e8231."
acceptanceCriteria:
  - "docs/packages/rex.md documents the tree-diff product map section, --format=markdown and --out with a CI example"
  - "A patch changeset for @n-dx/rex describes the tree-diff product map delta and Markdown comment output"
description: "Task 523e8231 added three things to `rex tree-diff`, documented only in packages/rex/src/cli/help.ts:\n- the product map delta section (capabilities and constraints added, modified, retired)\n- `--format=markdown`\n- `--out=<file>`\ndocs/packages/rex.md does not mention them, and no `.changeset/` entry for `@n-dx/rex` records them. The release notes will omit the feature, and operators wiring a CI step have only `--help` to go on.\n\nVerdict: should-fix (low), in scope for PR 18. Fix: add a short tree-diff subsection to docs/packages/rex.md with a CI example, plus a patch changeset for `@n-dx/rex`."
lastModified: "2026-10-09T07:54:02.639Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
