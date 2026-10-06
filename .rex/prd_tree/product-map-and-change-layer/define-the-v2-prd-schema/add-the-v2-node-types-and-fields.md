---
id: "51b89dab-a2b3-4ea1-82a1-974584bfe51d"
level: "task"
title: "Add the v2 node types and fields"
status: "pending"
priority: "high"
tags:
  - "pr-07"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
acceptanceCriteria:
  - "Every field in the design's intent and state tables has a type"
  - "prs and issues accept full URLs or tracker keys and reject bare owner/repo#n after expansion"
  - "Unknown keys are preserved by the zod schemas (passthrough)"
  - "No runtime code imports v2.ts yet"
description: "rex/src/schema/v2.ts: type replaces level; closed set area, capability, constraint, change, task, subtask; spike is a flag on a change. Capability: statement, criteria (each {id, text}), requirements, dependsOn, stewards on areas and root. Constraint: statement, requirements, appliesTo (all or ids). Change: intent, amends [{target, delta: added|modified|removed, summary, criteria {add, replace, remove}, proposed?, under?, title?}], touches, plannedRelease, prs, issues (full URLs or tracker keys; short forms expanded on write), assignee, ready, needsPlacement, spike, priority. Display ids (CH-n, A4.3), aliases, schema stamp rex/v2. Reserve hypothesis fields and links (no shape). State fields per the intent/state table."
lastModified: "2026-10-06T04:16:51.993Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
