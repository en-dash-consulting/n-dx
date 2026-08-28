---
id: "8c5cc23d-6545-48ba-9ab3-6005f08e5788"
level: "task"
title: "Stop labeling every unresolved finding as must-fix in the review warning"
status: "completed"
priority: "medium"
tags:
  - "review-pass"
  - "e2e-finding"
  - "severity:medium"
source: "ndx-capture"
startedAt: "2026-08-28T17:25:25.511Z"
completedAt: "2026-08-28T17:30:55.246Z"
endedAt: "2026-08-28T17:30:55.246Z"
resolutionType: "code-change"
resolutionDetail: "unresolvedFindings() now excludes capture failures; captureFailedCount added to RunReviewRecord; tests corrected and extended."
acceptanceCriteria:
  - "The warning distinguishes unrepaired must-fix findings from findings whose capture failed, with separate counts"
  - "A report with zero must-fix verdicts never produces a message claiming must-fix findings exist"
  - "run.review distinguishes the two counts, or renames unresolvedCount to match what it actually counts"
  - "A unit test covers a report with capture failures and no must-fix verdicts"
description: "cli-loop.ts:1187 prints `⚠ ${unresolved.length} must-fix finding(s) were not repaired. Inspect them before trusting this commit.` but unresolvedFindings() (adversarial-review.ts:526-530) returns `action === \"failed\" || (verdict === \"must-fix\" && action !== \"fixed\")` — it deliberately includes capture failures, which are not must-fix.\n\nRun 60c3a951 printed \"⚠ 4 must-fix finding(s) were not repaired\" against a report containing zero must-fix verdicts (2 out-of-scope, 2 should-fix, 1 not-worth-fixing). The four counted items were all action=\"failed\" from the add_item permission denial. Same number lands on run.review.unresolvedCount, so the run record carries the same overstatement.\n\nThe set is the right set — four things did need attention. Only the word \"must-fix\" is wrong, and it conflates \"a required repair did not happen\" with \"a finding could not be filed\", which are different operator actions. Splitting the message by cause would say what actually went wrong."
commits:
  - {"hash":"6048bc6dbd13079b273529345a247b269fe861ea","author":"Sterling H","authorEmail":"sterling.h@endash.us","timestamp":"2026-08-28T10:37:41-07:00"}
lastModified: "2026-08-28T17:37:42.401Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
