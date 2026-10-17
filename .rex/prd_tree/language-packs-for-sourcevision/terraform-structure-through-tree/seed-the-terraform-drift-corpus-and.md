---
id: "97e2635b-6c92-4077-9d1a-ba63893af801"
level: "task"
title: "Seed the Terraform drift corpus and measure parse rate"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "terraform"
  - "sourcevision"
  - "tests"
  - "pr-8"
blockedBy:
  - "c87df119-1d65-4f73-9675-a6f0b3b21858"
source: "roadmap"
acceptanceCriteria:
  - "The corpus list pins the three repositories by commit SHA"
  - "Results are in the rex log; at least 98% of .tf files parse cleanly, or the failing constructs are listed"
  - "The scripts are excluded from the default test run"
  - "The six static root policy tests pass"
description: "The operator has cloned (shallow) into ~/.cache/ndx-iac-corpus/:\n- cloud-foundation-fabric: https://github.com/GoogleCloudPlatform/cloud-foundation-fabric.git @ 67afe70eee502129368f5c370d6e7222f2e60ab0 (832 .tf, GCP)\n- terraform-aws-rds: https://github.com/terraform-aws-modules/terraform-aws-rds.git @ 175da043429cbbe41c512f976105719f6d0e538c (104 .tf, AWS)\nand ~/.cache/ndx-go-corpus/microservices-demo (8 .tf). Pin these, reuse the corpus scripts, never clone during the run. Report the clean-parse share, resource and module counts, and the comparison with infrastructure.ts. Gate: at least 98% clean parse. Append the results to the rex log."
lastModified: "2026-10-08T03:09:14.912Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
