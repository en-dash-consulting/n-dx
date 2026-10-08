---
id: "2d87cf58-8d10-47b0-b8a4-8365181f33aa"
level: "task"
title: "A multi-line amendment summary breaks the History section the apply engine writes"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "product-map"
source: "ndx-adversarial-review"
startedAt: "2026-10-08T04:27:24.965Z"
completedAt: "2026-10-08T04:32:58.297Z"
endedAt: "2026-10-08T04:32:58.297Z"
resolutionType: "code-change"
resolutionDetail: "applyAmendments collapses whitespace in the summary to one line before appendHistory; unit test covers newline plus heading."
acceptanceCriteria:
  - "Applying an amendment whose summary contains newlines writes exactly one History line with no new heading in the body"
  - "A unit test covers a summary containing a newline and a Markdown heading"
description: "Verdict: should-fix (adversarial review of 17a8312b). Scenario: an amendment summary of \"Tighten\\n\\n## Notes\" is copied verbatim into the History line by applyAmendments (packages/rex/src/core/apply-amendments.ts, the appendHistory call). The body gains a new \"## Notes\" heading. The next appendHistory treats that heading as the end of History and inserts the next line before it, so History entries split around injected text. An LLM-drafted change summary can carry newlines. Reachability: the engine is not wired yet. Options: (1) collapse whitespace in the summary to one line before writing it. This is one line of code. Recommended. (2) Reject a multi-line summary in AmendmentSchema. This is stricter but refuses existing hand-written changes.\n\nKept in PR 10 (Ryan, 2026-10-07) with the recommended fix: collapse whitespace in the summary to one line before writing the History line. The same run also does 2e50d91e (canonical depends-on-acyclic cycles in schema/v2-rules.ts)."
lastModified: "2026-10-08T04:32:58.852Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
