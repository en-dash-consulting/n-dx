---
id: "a166cda6-6137-49aa-8d81-6fb2f0a2187b"
level: "task"
title: "database-corpus-report shows no Terraform candidates on terraform-aws-rds or cloud-foundation-fabric"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "terraform"
  - "database"
  - "pr-13"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "database-corpus-report lists at least one terraform-signal candidate for terraform-aws-rds and for cloud-foundation-fabric, with the .tf file and line as evidence"
  - "A test covers a resource whose engine is a variable set by a literal module-call argument and yields a candidate (or the criterion is formally amended by Ryan)"
  - "The Java and Go report lines stay byte-identical"
description: "Found by adversarial review of 4cfaf841 (commit b6e123978). Verdict: should-fix (a decision for Ryan first).\n\nScenario: `node packages/sourcevision/scripts/database-corpus-report.mjs` prints \"no candidates\" for both Terraform repositories. It prints only notices:\n- terraform-aws-rds: modules/db_instance/main.tf:30 aws_db_instance.this engine `local.is_replica ? null : var.engine`.\n- cloud-foundation-fabric: modules/cloudsql-instance/main.tf:89 and :293 database_version `var.database_version`.\n\nThe corpus declares database resources only inside reusable modules. The literal engines (terraform-aws-rds examples/*/main.tf `engine = \"postgres\"`, cloud-foundation-fabric tests/fixtures/cloudsql-instance.tf) are module-call arguments, and the pack's ResourceFacts carry neither those nor variable values. 4cfaf841's criterion \"database-corpus-report shows Terraform candidates on terraform-aws-rds and cloud-foundation-fabric\" is therefore not met.\n\nReachable: yes, through the corpus report; analyze is not wired.\n\nOptions:\n(a) The Terraform pack resolves a resource's engine/engineVersion through a local module call's literal argument (`var.engine` ← `module \"db\" { engine = \"postgres\" }`), as a new optional fact field such as `attributes.engineResolved` with the call site. Cost: a lang-terraform model change plus a contract field for Sterling H to review. This finds the real usage. Recommended.\n(b) Accept notices as the result for module libraries and amend the criterion. Cost: none, but these corpora then never show Terraform candidates.\n\nDecision for Ryan: (a) adds a lang-kit field and pack work in PR 13 or later."
lastModified: "2026-10-15T15:24:54.554Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
