---
id: "2f0be1fb-a9bd-45ae-b8d5-65e5b15cc1b6"
type: "change"
title: "Review report transport, parsing, and run-record recording"
slug: "review-report-transport-parsing-and"
intent: "The reviewer writes JSON to .hench/reviews/<run-id>.json rather than printing it, so the report has one writer, one reader, and an unambiguous absent state. Keyed by run so a re-review keeps both, and cleared before each pass so a stale report cannot be read as current. Unknown enum values are coerced toward alarm: an unrecognized severity becomes critical, an unrecognized action becomes failed. A broken review never fails a valid task; the outcome lands on run.review so a review that silently did not happen cannot read as one that found nothing."
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
priority: "high"
---
