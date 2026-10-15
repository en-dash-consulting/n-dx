---
id: "0275d02e-0d94-46dc-a533-17c38330caa0"
level: "task"
title: "Terraform model build is quadratic in resources × reference edges"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-terraform"
  - "pr-13"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A unit test builds a synthetic model of 20k resources and 150k reference edges in one directory, and `buildTerraformModel` finishes it within a generous wall-clock bound (for example 5 s). The test registers in the wall-clock inventory if the policy requires it."
  - "`settle` and the provider-version lookup read pre-built indexes, not a scan of all references or requirements per resource."
  - "The Terraform pack goldens (golden.json and model.json) are unchanged."
description: "Verdict: should-fix (from the adversarial review of c87df119).\n\nFailure scenario: `buildTerraformModel` (packages/lang-terraform/src/terraform-model.ts) has three hotspots:\n- `settle` filters the whole `references` list once per resource and data source: O(R × E).\n- `versionOf` scans every requirement once per resource.\n- Within each file, `readFile` scans all captures in `inside()` and all arguments in `argumentsIn()` once per block: O(blocks × captures).\n\nOn cloud-foundation-fabric (898 resources, 8356 edges) this is about 7.5M comparisons, which is fine. An enterprise IaC monorepo with 20k resources and 150k edges would make about 3e9 comparisons in `settle` alone. That is minutes of analyze time on a path nobody can interrupt.\n\nReachability: today only through the pack entry (`pack.analyzeProject`) and tf-corpus-report.mjs. The Terraform pack is not wired into analyze yet. The next task (\"Write the Terraform model into infrastructure.json\") wires it in, so this becomes reachable from `ndx analyze` on Terraform repos with the pack installed.\n\nOptions:\n1. (Recommended) Index once. Group references by `directory\\0from` into a Map. Map requirements by `directory\\0name`. In `readFile`, assign captures to their top-level block in one ordered pass, since both lists are in document order. Cost: about 30 lines. Risk: low; the goldens pin the output.\n2. Index only `settle` and `versionOf`. This is the cheapest change and removes the cross-file quadratic. The per-file quadratic stays, bounded by the runner's 1 MB file limit."
lastModified: "2026-10-15T14:45:44.541Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
