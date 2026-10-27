---
id: "2b3d4191-e2ca-4d64-9944-c4e05734f5fc"
type: "change"
title: "Write the hench run log incrementally while the run is in progress"
slug: "write-the-hench-run-log-incrementally"
intent: "Today `packages/hench/src/store/run-log.ts` writes the whole `.run-logs/<ts>-<runId>.log` once, when the run ends (`agent/lifecycle/shared.ts`). Open the file when the run starts and append each output line as it is produced, so a reader can tail it while the run is in progress. Record the log path on the run record (optional field in `schema/v1.ts` and its zod schema in `validate.ts`) so readers do not have to guess the timestamped filename. The final file must have the same content and format as the one written today, including the review pass output when `--review` is on. Flush often enough that a tail sees new lines within a second; never block the agent loop on disk writes."
acceptanceCriteria:
  - "The log file exists within 2 seconds of a run starting and grows line by line as the run progresses, for both CLI-loop and API-loop runs."
  - "The run record carries the log file path from the start of the run; records without the field still load."
  - "When the run ends, the file content is identical to what the end-of-run writer produces today (regression test compares the two)."
  - "A run that crashes mid-way leaves a readable partial log rather than none."
  - "Changeset for @n-dx/hench (patch)."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
tags:
  - "live"
  - "hench"
---
