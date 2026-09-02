---
id: "760d43c9-466a-4daf-95ff-8c6754c4857e"
level: "task"
title: "Implement hash-suffix-aware duplicate title detector for reshape consolidation"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "reshape"
  - "prd"
source: "smart-add"
startedAt: "2026-05-14T14:02:16.048Z"
completedAt: "2026-05-14T14:14:08.845Z"
endedAt: "2026-05-14T14:14:08.845Z"
resolutionType: "code-change"
resolutionDetail: "Added detectHashSuffixDuplicatesInTree (exported) with HashSuffixDuplicateGroup return type; extended stripHashSuffix to cover bracketed UUID and dash-style tails; replaced private tree function in reshape.ts; 40 new unit tests all pass."
acceptanceCriteria:
  - "Detector identifies sibling tasks whose titles differ only by a trailing hash/ID suffix and groups them under a normalized title"
  - "Suffix-stripping regex covers parenthesized hex/uuid fragments and ` - <hash>`-style tails, with unit tests for each shape"
  - "Detector returns parent context, member IDs, child counts, and normalized title for each group"
  - "Tasks with genuinely different titles (more than the suffix) are not grouped, verified by negative-case fixtures"
  - "Output feeds the existing reshape merge audit-trail pipeline without bypassing archive recording"
description: "Add a detector to the reshape pipeline that groups sibling tasks whose titles match after stripping a trailing hash/ID suffix pattern (parenthesized hex/uuid fragments, ` - <id>` tails, etc.). The detector must return groups of candidate duplicates with their parent context, child counts, and a normalized canonical title, feeding into the consolidation step that follows."
---
