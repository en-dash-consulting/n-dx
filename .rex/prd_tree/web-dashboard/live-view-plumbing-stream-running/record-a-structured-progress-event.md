---
id: "dc5bae73-cdb5-4b87-8d03-d59dfc7aa202"
level: "task"
title: "Record a structured progress event stream for every hench run, not only in verbose mode"
status: "completed"
priority: "high"
tags:
  - "live"
  - "hench"
startedAt: "2026-10-01T01:06:07.699Z"
completedAt: "2026-10-01T01:39:11.936Z"
endedAt: "2026-10-01T01:39:11.936Z"
resolutionType: "code-change"
resolutionDetail: "Every run now appends typed progress events as JSON Lines to .hench/runs/<runId>.events.jsonl, with the path on the additive RunRecord.eventsPath. New store/run-events.ts owns the vocabulary (9 kinds), the writer, the process-wide emitter, per-turn read batching and tool classification; both agent loops emit from hooks they already ran. Retention takes the sidecar with its run."
acceptanceCriteria:
  - "Every run writes an events file that a reader can tail while the run is in progress; each line parses as one typed event."
  - "Events cover at least: brief loaded, file read (batched per turn), file edited, test or validation run with counts, retry with reason, gate passed or failed, review started, review report written, run finished."
  - "Verbose mode output is unchanged; the event file adds no LLM calls and no measurable turn latency."
  - "Run records without the events path still load."
  - "Changeset for @n-dx/hench (patch)."
description: "The Live task page's Work tab shows one plain-language line per step: brief loaded (criteria count, model, permission mode), files read, files edited with line counts, test or validation runs with pass/fail counts, retries and the reason, gates (test gate, commit gate), the review pass starting and its report being written, and the current step. `RunRecord.events` (`packages/hench/src/schema/v1.ts`) is filled only in verbose/debug mode and saved with the record at the end. Append these events as JSON lines to a per-run file under `.hench/runs/` as they happen, always, and record its path on the run record (optional field). Keep the event vocabulary small and typed (kind, timestamp, summary, optional detail and counts) so the viewer can render it without parsing log text. Reuse the existing tool-call and turn hooks in the agent loops; do not add LLM calls to produce summaries."
lastModified: "2026-10-01T01:39:12.314Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
