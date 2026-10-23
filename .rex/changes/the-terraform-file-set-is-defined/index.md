---
id: "82129f65-3d31-431c-983e-6c3257011463"
type: "change"
title: "The Terraform file set is defined three times and can drift between detection and inventory"
slug: "the-terraform-file-set-is-defined"
intent: "Verdict: should-fix (adversarial review of b88d60d0). Severity low; no current failure.\n\nThe set of Terraform files (.tf, .tfvars, terragrunt.hcl, .tftest.hcl) is hand-listed in detect.ts isTerraformFile, in inventory.ts (EXT_TO_LANGUAGE + the terragrunt/.tftest.hcl name check) and in terraform.ts (extensions, configFilenames, configFilePatterns, testFilePatterns). b88d60d0 itself was a drift between two of these copies. Scenario: someone adds .tf.json or .tfvars.json to the inventory only → files inventoried as Terraform in a repo detection calls non-Terraform again.\n\nOptions:\n1. Export one predicate (e.g. isTerraformFile in terraform.ts, built from terraformConfig fields) and use it in detect.ts and inventory.ts. Cheap; check inventory.ts may import from language/ without a cycle.\n2. Add a test asserting the three agree on a list of names. Cheaper, catches drift but keeps duplication.\nRecommend 1."
acceptanceCriteria:
  - "detect.ts and inventory.ts decide whether a file is Terraform through one shared definition"
  - "A test fails if a filename is treated as Terraform by the inventory but not by detection"
touches:
  - "8b4b34af-ec1d-4593-8266-67e39928289c"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "terraform"
  - "sourcevision"
source: "ndx-adversarial-review"
---
