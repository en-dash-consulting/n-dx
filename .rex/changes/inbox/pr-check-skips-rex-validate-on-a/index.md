---
id: "dd705e62-2e96-466f-8e74-afb6bf0d783a"
type: "change"
title: "pr-check skips rex validate on a project that uses the .ndx/ layout"
slug: "pr-check-skips-rex-validate-on-a"
intent: "pr-check.js (~88) checks `existsSync(join(dir, \".rex\"))`; on the `.ndx/` layout (rex at `.ndx/rex/`) it reports \"skipped (no .rex directory)\" and never runs `rex validate`, so a broken PRD passes the PR gate. Repro: `node pr-check.js <dir>` on a project with only `.ndx/rex/`.\n\nReachable: yes, on every project migrated to the .ndx layout.\n\nFix options: (1, recommended) resolve the rex directory with the layout resolver (core/layout.js) instead of a literal; small.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "pr-check runs rex validate on a project whose PRD lives under .ndx/rex/"
  - "A test runs pr-check on a .ndx-layout fixture with an invalid PRD and asserts it fails"
priority: "medium"
source: "ndx-adversarial-review"
---
