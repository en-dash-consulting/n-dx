---
id: "5f84e163-4e1a-4bf0-9379-d9926cdd57ae"
level: "task"
title: "Terraform files deeper than three directories are inventoried but not detected"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "terraform"
  - "sourcevision"
blockedBy:
  - "82129f65-3d31-431c-983e-6c3257011463"
source: "ndx-adversarial-review"
startedAt: "2026-10-11T06:20:03.810Z"
completedAt: "2026-10-11T06:29:27.526Z"
endedAt: "2026-10-11T06:29:27.526Z"
resolutionType: "code-change"
resolutionDetail: "Option 1: detection walks through the inventory's shared walk (util/project-walk.ts) with the same skip set, no depth cap, early exit. Commit 17db381b3."
acceptanceCriteria:
  - "A fixture whose only Terraform file is live/prod/us-east-1/vpc/app/terragrunt.hcl yields detectLanguages containing terraformConfig, or yields no Terraform inventory entries"
  - "Detection and the inventory skip the same directories for Terraform files"
  - "Detection for a TypeScript repo with no Terraform files stays unchanged and does not walk unbounded vendored trees"
description: "Verdict: out-of-scope (pre-existing; surfaced reviewing b88d60d0). Severity medium.\n\nScenario: a Terragrunt live repo laid out as live/root.hcl + live/prod/us-east-1/vpc/app/terragrunt.hcl (or any .tf / .tfvars four or more directories deep, with no Terraform file at depth ≤3). detect.ts hasTerraformMarker stops recursing at depth 3, so detectLanguages omits terraformConfig, while inventory.ts walks the whole tree and maps those files to \"Terraform\" globally. Result: inventory lists Terraform files while manifest.languages does not, the mismatch b88d60d0 meant to remove. The modern Terragrunt root file is root.hcl (not a marker), so the deep leaf files are often the only evidence.\n\nEvidence: packages/sourcevision/src/language/detect.ts hasTerraformMarker (`if (depth >= 3) return false`); packages/sourcevision/src/analyzers/inventory.ts (EXT_TO_LANGUAGE .tf/.tfvars, terragrunt.hcl mapping; no depth limit). Skip sets also differ: detection skips node_modules/vendor/venv/site-packages; the inventory uses BASE_SKIP_DIRS + VENDOR_SKIP_DIRS + gitignore.\n\nReachable via `sv analyze` / `ndx analyze` on any such repo.\n\nOptions:\n1. Raise or remove the depth cap (bounded by the same skip sets as inventory). Cost: slower detection on large non-Terraform trees; mitigate with an early exit and shared skip set.\n2. Gate the inventory's Terraform mapping on Terraform being detected (more plumbing; acceptFile uses a global map).\n3. Derive detection from the inventory result after the walk.\nRecommend 1 with the inventory's skip set, or 3 if detection can be moved after inventory without changing other languages' output."
lastModified: "2026-10-11T06:29:27.802Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
