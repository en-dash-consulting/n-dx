---
id: "3a6eba05-c017-46a8-9dd2-7732d0df082e"
level: "task"
title: "Add the missing changeset for Terraform zone, detection and role changes"
status: "completed"
priority: "high"
source: "review"
startedAt: "2026-10-17T01:25:50.130Z"
completedAt: "2026-10-17T01:28:44.773Z"
endedAt: "2026-10-17T01:28:44.773Z"
resolutionType: "code-change"
resolutionDetail: "Added .changeset/sv-terraform-zones-detection-roles.md (@n-dx/sourcevision patch) covering zones exclusion, any-depth detection, .terraform skip, case-sensitive isTerraformPath names and Terraform roles."
acceptanceCriteria:
  - "A @n-dx/sourcevision patch changeset describes the zones exclusion, any-depth detection, the .terraform skip, case-sensitive paths and the Terraform roles"
description: "Stack review (#768): no changeset, but published sourcevision behaviour changes: Terraform is excluded from zones; Terraform is detected at any depth; .terraform/ is skipped in every repo (changing the inventory of a TS repo whose un-ignored .terraform/modules holds JS); isTerraformPath became case-sensitive; Terraform files get role config, or test on another language's test path. Add a @n-dx/sourcevision patch changeset describing each. Changeset file only."
lastModified: "2026-10-17T01:28:45.695Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
