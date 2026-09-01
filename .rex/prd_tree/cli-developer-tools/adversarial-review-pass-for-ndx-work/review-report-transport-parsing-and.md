---
id: "2f0be1fb-a9bd-45ae-b8d5-65e5b15cc1b6"
level: "task"
title: "Review report transport, parsing, and run-record recording"
status: "completed"
priority: "high"
startedAt: "2026-08-26T04:45:05.261Z"
completedAt: "2026-08-26T04:45:05.261Z"
endedAt: "2026-08-26T04:45:05.261Z"
acceptanceCriteria: []
description: "The reviewer writes JSON to .hench/reviews/<run-id>.json rather than printing it, so the report has one writer, one reader, and an unambiguous absent state. Keyed by run so a re-review keeps both, and cleared before each pass so a stale report cannot be read as current. Unknown enum values are coerced toward alarm: an unrecognized severity becomes critical, an unrecognized action becomes failed. A broken review never fails a valid task; the outcome lands on run.review so a review that silently did not happen cannot read as one that found nothing."
lastModified: "2026-08-26T04:45:05.269Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
