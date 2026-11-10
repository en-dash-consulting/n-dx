---
id: "85f347e4-607d-4e9f-97e0-1841d54088ba"
type: "change"
title: "A hench-written run verdict stays as the task's failureReason after later failures with a different cause"
slug: "a-hench-written-run-verdict-stays-as"
intent: "Found by the adversarial review of task c816a1a3 (run classifier).\n\nScenario: attempt 1 of a task fails as vendor-transient, so recordRunDiagnosis (packages/hench/src/agent/lifecycle/run-diagnosis.ts, fillFailureReason) writes \"The vendor kept failing transiently; retries ran out.\" as the task's failureReason. Attempt 2 fails as test-gate-new. fillFailureReason never overwrites, so failureReason still names the vendor. The brief for attempt 3 (agent/planning/brief.ts \"Previous attempt failed — do not repeat it\", and rex change-brief.ts) hands the agent the stale vendor cause instead of the test-gate digest. Nothing clears failureReason when the task later completes either.\n\nReachability: every ndx work run that ends non-completed goes through finalizeRun → recordRunDiagnosis.\n\nVerdict: should-fix. The \"never overwrite an existing failureReason\" acceptance criterion protects a reason a person or the agent wrote. A verdict hench itself wrote is not that, but today the two can't be told apart.\n\nOptions:\n1. (Recommended) Record which failureReason hench wrote, for example as the latest run's diagnosis.summary. Overwrite failureReason only when it still equals a summary a previous run of the task wrote. Cost: one read of the task's earlier runs (already loaded for attempt counting). Risk: low.\n2. Add a separate verdict field for the brief, and leave failureReason only to people and agents. Cost: a rex schema field, under the soft freeze.\n3. Clear a hench-written failureReason when the task completes. This fixes only the completed case."
acceptanceCriteria:
  - "When a task's failureReason was written by a previous run's verdict, the next failed run's verdict replaces it (tested: vendor-transient then test-gate-new leaves the test-gate summary)"
  - "A failureReason written by a person or by the agent (rex update --reason, update_task_status) is never overwritten by a verdict (tested)"
  - "The next run's brief carries the latest run's verdict summary, not the first one's"
touches:
  - "3415b5f0-3496-4813-8cc9-9f571044d49c"
priority: "medium"
discoveredFrom: {"item":"c816a1a3-5786-4e25-aad2-5a432be1e7de","run":"e7dce010-1a76-4b07-95d2-7b256b66dec8"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
