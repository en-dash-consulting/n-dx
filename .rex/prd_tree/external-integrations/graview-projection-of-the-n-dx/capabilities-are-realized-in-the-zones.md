---
id: "9df350f1-c56a-4520-a01e-e7e33b97e354"
level: "task"
title: "Capabilities are realized in the zones of every change placed on them, from run commits as well as trailers"
status: "completed"
priority: "high"
tags:
  - "graview"
  - "evidence"
  - "rex"
blockedBy:
  - "95666ab1-b2ee-4559-a40b-d1b221448c6f"
  - "dd5bcb32-e250-472a-ba3f-4033e46b7dc5"
source: "ndx-capture"
startedAt: "2026-10-11T03:56:20.921Z"
completedAt: "2026-10-11T04:03:59.959Z"
endedAt: "2026-10-11T04:03:59.959Z"
resolutionType: "code-change"
resolutionDetail: "Run commits land for their task and realize capabilities through every placed change; git describes commit nodes; loadCommitFiles public"
acceptanceCriteria:
  - "Every commit a run record names is a commit node with a landedFor edge to the run's task and an attribution field from the record (trailer commits say trailer)"
  - "A capability has a realizedIn edge to each zone holding a file changed by a commit that landed for a change placed on it (amends or touches) or for a task under that change; realizes edges from those commits to the capability follow"
  - "loadCommitFiles is on rex's public API and the adapter reads files through it, caching under the graview dir"
  - "On this repository most capabilities built in the hench era show at least one zone once hench backfill-commits has run; the snapshot test covers a touches-placed change realized through a run commit"
  - "The commit kind in n-dx.graview.json declares attribution; the face fixture is regenerated and its drift test passes"
description: "The projection's realizedIn edges come from computeRealizedBy: trailer commits only, through amending changes only. On a proposed product layer the amends/touches relation is a lead-verb guess, and the hench-era commits reach the graph only through run records. The adapter widens the evidence while rex's strict reading stays as it is: every commit a run record names becomes a commit node that landedFor the run's task (carrying the record's attribution), and a capability is realizedIn the zones of the files of every commit that landed for a change placed on it by amends or touches, or for a task under such a change, from trailers and run records alike. Rex exposes loadCommitFiles publicly so the adapter reuses its cached file scan. The commit kind declares attribution; the face's capability page already lists zones realized in and the home's coverage picture already counts them."
lastModified: "2026-10-11T04:04:00.218Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
