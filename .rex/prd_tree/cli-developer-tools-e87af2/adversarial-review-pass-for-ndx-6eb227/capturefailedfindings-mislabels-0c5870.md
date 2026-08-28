---
id: "0c587080-76ec-4380-8f28-775117662533"
level: "task"
title: "captureFailedFindings mislabels a must-fix whose own repair attempt failed as a capture failure"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "review-pass"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A must-fix finding recorded with action=\"failed\" is excluded from captureFailedFindings()'s result"
  - "The same must-fix+failed finding still appears in unresolvedFindings()'s result"
  - "A unit test covers a report containing only a must-fix finding with action=\"failed\" and asserts it lands in unresolvedFindings but not captureFailedFindings"
  - "cli-loop's capture-failed warning no longer fires for a must-fix repair failure"
description: "`captureFailedFindings` (packages/hench/src/agent/analysis/adversarial-review.ts:553-555) filters purely on `f.action === \"failed\"`, with no verdict check:\n\n```ts\nexport function captureFailedFindings(report: ReviewReport): ReviewFinding[] {\n  return report.findings.filter((f) => f.action === \"failed\");\n}\n```\n\nBut `action: \"failed\"` is not exclusively a capture-failure marker. The review brief itself instructs the reviewer to use it for a failed *fix* attempt on a must-fix finding too (adversarial-review.ts:336-337: \"If a fix does not work, stop and report it. Record the finding as `failed` with what you tried\").\n\n**Trigger:** reviewer attempts a must-fix repair, the edit doesn't work, and it records `{ verdict: \"must-fix\", action: \"failed\", note: \"tried X, broke Y\" }` per the brief's own instructions.\n\n**Wrong output:** `captureFailedFindings` includes this finding, so cli-loop.ts (~line 1210-1217) prints \"⚠ 1 finding(s) could not be captured to the PRD. They are preserved in <path> — file them before the report is overwritten.\" That is factually wrong — nothing about a must-fix finding was ever meant to be captured — and tells the operator the wrong remediation (file it in the PRD) instead of the correct one (inspect/fix the commit, which the adjacent `unresolvedFindings`-driven warning already says correctly). The same finding fires both warnings at once, one of them misleading. It also means `run.review.captureFailedCount` (added in 8c5cc23d) overcounts: a failed must-fix repair gets counted as a capture failure it never attempted.\n\n**Reachable:** yes, via the reviewer's own documented instructions — not synthetic. Not currently covered by any test; grepped `packages/hench/tests` for `verdict.*must-fix.*action.*failed` and found no matches, and `captureFailedFindings`'s own test file has no case combining verdict \"must-fix\" with action \"failed\".\n\n**Fix option (recommended):** narrow the filter to `(f) => f.action === \"failed\" && f.verdict !== \"must-fix\"`, and add a test asserting a must-fix+failed finding is excluded from `captureFailedFindings` but included in `unresolvedFindings`. Small, low-risk change confined to one function plus its docstring (which currently says \"Findings the reviewer meant to file but could not\" — accurate only once the verdict check is added).\n\nFound during the adversarial review of 8c5cc23d (\"Stop labeling every unresolved finding as must-fix in the review warning\"), which fixed the analogous conflation in `unresolvedFindings` but left this one in the pre-existing, untouched `captureFailedFindings`. Out-of-scope for that task since `captureFailedFindings` was not part of its diff (introduced earlier, in 120b14)."
lastModified: "2026-08-28T17:36:31.903Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
