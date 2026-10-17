---
id: "dce5c939-6e58-47c2-b102-463a514a06f6"
level: "task"
title: "Add the missing changeset for Go files that declare themselves generated"
status: "completed"
priority: "high"
source: "review"
startedAt: "2026-10-17T01:23:11.503Z"
completedAt: "2026-10-17T01:26:14.889Z"
endedAt: "2026-10-17T01:26:14.889Z"
resolutionType: "code-change"
resolutionDetail: "Added .changeset/sv-go-generated-header.md (@n-dx/sourcevision patch)."
acceptanceCriteria:
  - "A @n-dx/sourcevision patch changeset describes the generated-header role change and its effect on classifications.json and summary.byRole"
description: "Stack review (#765): this PR changes user-visible output but has no changeset. Go files with a // Code generated ... DO NOT EDIT. header (sqlc, ent, mockgen, protoc) move from role source to generated, which drops them from classifications.json and changes summary.byRole. Add a @n-dx/sourcevision patch changeset saying so. Changeset file only."
lastModified: "2026-10-17T01:26:15.197Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
