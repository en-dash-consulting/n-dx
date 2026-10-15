---
id: "f938c362-af6a-4709-bf81-fb9a8915f483"
level: "task"
title: "A listed but missing Terraform pack gives two notices per analyze in a Terraform repo"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "terraform"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test analyzes a project that lists terraform in sourcevision.packs, has a classified .tf resource and has no Terraform pack, and asserts exactly one Terraform notice"
  - "When the project lists terraform and has .tf files but infrastructure.json lists no Terraform resource, the listed-pack notice still prints once"
  - "Notice behaviour for Java and Go listed packs is unchanged (existing pack-imports tests pass unedited)"
description: "Verdict: should-fix (low), from the adversarial review of f8e173a9 (commit cd177bdc8).\n\nScenario: a project lists `\"terraform\"` in `sourcevision.packs`, `infrastructure.json` lists a resource from a `.tf` file, and @n-dx/lang-terraform is missing or refused. `sv analyze` then prints two notices for the same cause:\n1. `sourcevision.packs lists terraform: pack … is not installed. Install it with …`, from `noticeListedPacks`, called in `analyzers/imports.ts` around line 733.\n2. `Terraform: pack … is not installed; infrastructure.json gets no Terraform model fields. …`, from `enrichTerraformInfrastructure` in `analyzers/terraform-infrastructure.ts`.\n\nThe listed-pack contract (packages/sourcevision/AGENTS.md, \"The project pack list\") says a listed pack that has files is reported by the normal degrade path, not a second time. The imports phase builds `withFiles` from `packsFor(...)` only, and that never includes terraform (its `parseableExtensions` are empty), so terraform is never counted as already reported.\n\nReachable: `ndx analyze` / `sv analyze` on any Terraform project that lists the pack without having it installed. Effect: console noise only, no wrong output.\n\nOptions:\n- (A, recommended) In `analyzeImports`, add the non-imports packs whose files exist (terraform when the inventory has `.tf` files) to the `reported` set, and leave the notice to the enrichment step. Cost: a few lines plus a test. Risk: the enrichment step stays silent when the project has `.tf` files but no listed resource, so in that case no notice would print at all. Keep the listed notice in that case.\n- (B) Run the listed-pack notice after infrastructure enrichment and pass it the ids the enrichment already reported. Cost: moving the notice across phases. Risk: the notice ordering changes."
lastModified: "2026-10-15T15:11:47.973Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
