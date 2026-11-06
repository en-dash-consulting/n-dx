---
id: "ac477abd-c5e2-4490-b4fc-ad982cdf5906"
type: "task"
title: "Re-record the prompt-token baseline after P1's prompt edits"
slug: "re-record-the-prompt-token-baseline"
description: "P1 task 03b49289 edited the adversarial reviewer prompt (packages/hench/src/agent/analysis/adversarial-review.ts), and its review found that the checked-in baseline docs/analysis/prompt-token-baseline.json is now stale, so tests/e2e/prompt-census.test.js fails. On a clean tree, run node scripts/prompt-census.mjs --write (it refuses a dirty tree), commit the regenerated baseline and its generated Markdown in their own commit, and confirm tests/e2e/prompt-census.test.js passes. Change nothing else; if the census reports an unexpected delta outside the reviewer prompt, stop and say what it is."
acceptanceCriteria:
  - "tests/e2e/prompt-census.test.js passes with the regenerated baseline"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":false}
source: "ndx-capture"
---
