---
id: "b88d60d0-987d-4d12-b99a-d5cc5d9129dd"
level: "task"
title: "terragrunt.hcl and .tfvars are inventoried as Terraform in repos where detection finds no Terraform"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "terraform"
  - "sourcevision"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A fixture with only terragrunt.hcl and prod.tfvars yields detectLanguages containing terraformConfig, or yields no Terraform inventory entries — never one without the other"
  - "A test covers the Terragrunt-only repository case"
description: "Verdict: should-fix (adversarial review of 442fc751). Severity low.\n\nScenario: a Terragrunt \"live\" repo with only terragrunt.hcl and *.tfvars files, and no .tf. inventory.ts's detectLanguage maps them to \"Terraform\" globally, so they now appear in inventory.json, which they did not before. But detect.ts hasTerraformMarker looks only for .tf, so manifest.languages does not list terraform. The result is an inventory/language mismatch, and the output changes for a repo \"without .tf files\", against the letter of the 442fc751 criterion.\n\nEvidence: packages/sourcevision/src/analyzers/inventory.ts (terragrunt.hcl / .tftest.hcl name mapping, .tfvars in EXT_TO_LANGUAGE); packages/sourcevision/src/language/detect.ts hasTerraformMarker.\n\nOptions:\n1. Count terragrunt.hcl (and .tfvars) as Terraform markers in hasTerraformMarker. This is cheap and makes detection agree with the inventory.\n2. Gate the inventory mapping on Terraform being detected. More plumbing, because acceptFile uses a global map.\nRecommend 1. The decision is whether a Terragrunt-only repo counts as Terraform."
lastModified: "2026-10-08T07:53:23.072Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
