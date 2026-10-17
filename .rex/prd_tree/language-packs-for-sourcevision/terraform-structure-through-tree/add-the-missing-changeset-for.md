---
id: "41df209d-75fa-412c-8f5a-784d08cf2a31"
level: "task"
title: "Add the missing changeset for Terraform files entering the inventory"
status: "in_progress"
priority: "high"
source: "review"
startedAt: "2026-10-17T01:29:55.536Z"
acceptanceCriteria:
  - "A @n-dx/sourcevision patch changeset describes .tf files in inventory.json and terraform in manifest.languages"
description: "Stack review (#767): no changeset. After this PR every repo containing .tf files gains inventory.json entries for them (.tf leaves summary.skippedExtensions) and manifest.languages gains terraform. Add a @n-dx/sourcevision patch changeset describing both. Changeset file only."
lastModified: "2026-10-17T01:29:55.802Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
