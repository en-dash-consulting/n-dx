---
id: "9bb0bb90-9598-4982-8b49-b6f296ae9830"
level: "task"
title: "A multi-line editorial summary breaks the History section a product edit writes"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "product-map"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "An editorial product edit whose summary contains a newline and a Markdown heading writes exactly one History line, and the body gains no new heading"
  - "appendHistory itself writes a multi-line line argument as a single line (unit test in apply-amendments.test.ts)"
description: "Verdict: should-fix (adversarial review of 2d87cf58). 2d87cf58 collapsed newlines in the amendment summary only in applyAmendments. The other History writer, handleProductEdit's editorial path (packages/rex/src/core/product-edit.ts:115,123), writes options.summary after only .trim(). Scenario: editorial edit with summary \"Typo\\n\\n## Notes\" → the body gains a \"## Notes\" heading, and the next appendHistory inserts before it, so History splits. Reachability: handleProductEdit has no production caller yet (tests only). Options: (1) Recommended: move the whitespace collapse into appendHistory, so every caller writes one line, and drop the call-site collapse in apply-amendments.ts. One line, and it covers future callers. (2) Repeat the collapse at product-edit.ts:115. This is cheaper but leaves the trap for the next caller. The drafted-amendment summaries (lines 132 and 143) are already covered once apply runs."
lastModified: "2026-10-08T04:28:45.382Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
