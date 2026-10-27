---
id: "3a6eba05-c017-46a8-9dd2-7732d0df082e"
type: "change"
title: "Add the missing changeset for Terraform zone, detection and role changes"
slug: "add-the-missing-changeset-for"
intent: "Stack review (#768): no changeset, but published sourcevision behaviour changes: Terraform is excluded from zones; Terraform is detected at any depth; .terraform/ is skipped in every repo (changing the inventory of a TS repo whose un-ignored .terraform/modules holds JS); isTerraformPath became case-sensitive; Terraform files get role config, or test on another language's test path. Add a @n-dx/sourcevision patch changeset describing each. Changeset file only."
acceptanceCriteria:
  - "A @n-dx/sourcevision patch changeset describes the zones exclusion, any-depth detection, the .terraform skip, case-sensitive paths and the Terraform roles"
amends: [{"target":"d8fccdeb-f9b5-4da2-be41-c5594fa0451f","delta":"modified","summary":"Add the missing changeset for Terraform zone, detection and role changes","base":"6ec46898c964d0433544682c976e2d2209ce8276d65f6771a0ae4dec4f67faff"}]
priority: "high"
source: "review"
---
