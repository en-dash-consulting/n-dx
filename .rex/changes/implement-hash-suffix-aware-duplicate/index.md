---
id: "760d43c9-466a-4daf-95ff-8c6754c4857e"
type: "change"
title: "Implement hash-suffix-aware duplicate title detector for reshape consolidation"
slug: "implement-hash-suffix-aware-duplicate"
intent: "Add a detector to the reshape pipeline that groups sibling tasks whose titles match after stripping a trailing hash/ID suffix pattern (parenthesized hex/uuid fragments, ` - <id>` tails, etc.). The detector must return groups of candidate duplicates with their parent context, child counts, and a normalized canonical title, feeding into the consolidation step that follows."
acceptanceCriteria:
  - "Detector identifies sibling tasks whose titles differ only by a trailing hash/ID suffix and groups them under a normalized title"
  - "Suffix-stripping regex covers parenthesized hex/uuid fragments and ` - <hash>`-style tails, with unit tests for each shape"
  - "Detector returns parent context, member IDs, child counts, and normalized title for each group"
  - "Tasks with genuinely different titles (more than the suffix) are not grouped, verified by negative-case fixtures"
  - "Output feeds the existing reshape merge audit-trail pipeline without bypassing archive recording"
amends: [{"target":"11be7299-0ef9-4b4e-808a-a09e98fe708e","delta":"modified","summary":"Implement hash-suffix-aware duplicate title detector for reshape consolidation","base":"0d2d8f66cc2b6e2f7d6be8f8425d83f72582d25a470eea6505f9c874554b57af"}]
priority: "high"
tags:
  - "rex"
  - "reshape"
  - "prd"
source: "smart-add"
---
