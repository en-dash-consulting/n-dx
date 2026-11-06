---
id: "293a63b3-bc3b-47a9-8596-6ea5dc7cc850"
type: "task"
title: "Scoped viewers' stages in viewer-architecture.md"
slug: "scoped-viewers-stages-in-viewer"
description: "Stack review round 2 finding on #961 (review body), docs/architecture/viewer-architecture.md line ~128: it reads 'Each scope list includes its own stage page (analyze, plan or work) and no other', but #961 adds \"tune\" to both REX_SCOPE_VIEWS and HENCH_SCOPE_VIEWS (view-routing.ts)."
acceptanceCriteria:
  - "docs/architecture/viewer-architecture.md says hench owns Tune and a Rex viewer borrows it for the PRD Graph and Execution Log, showing only Rex's views"
---
