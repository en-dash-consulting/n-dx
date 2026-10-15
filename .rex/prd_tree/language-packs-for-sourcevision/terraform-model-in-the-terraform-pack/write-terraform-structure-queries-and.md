---
id: "c87df119-1d65-4f73-9675-a6f0b3b21858"
level: "task"
title: "Write Terraform structure queries and build the in-memory model"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "terraform"
  - "lang-terraform"
  - "pr-13"
blockedBy:
  - "442fc751-4ea4-4a7f-855f-77a9e31f9a4a"
  - "97e2635b-6c92-4077-9d1a-ba63893af801"
source: "roadmap"
acceptanceCriteria:
  - "packages/lang-terraform holds the Terraform queries and model, and its pack entry produces \"resources\"; lang-kit lists \"resources\" as produced"
  - "lang-kit's ResourceFact has the optional module, provider, references and attributes fields, documented, with no tree-sitter type"
  - "Goldens in packages/lang-terraform cover every block kind listed and the audit attributes for RDS, Cloud SQL, Lambda or Cloud Functions, and EKS or GKE"
  - "tf-corpus-report.mjs prints resources and modules per repository and shows the model is a superset of infrastructure.ts's resources on terraform-aws-rds and cloud-foundation-fabric"
  - "Terraform files under tests/ in a Terraform-first fixture get the test role; zones still exclude Terraform; sv analyze output for the non-Terraform snapshot repos is unchanged"
  - "analyzers/infrastructure.ts is unchanged and no package.json dependency changes"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Rewritten 2026-10-15 for the pack architecture (12a) and the PR 13 decisions; the earlier text's \"write nothing new to infrastructure.json\" gate is replaced by the feature's decisions, and this task still persists nothing (the next task does).\n\nBuild the Terraform model inside @n-dx/lang-terraform (packages/lang-terraform; it already builds the pinned tree-sitter-hcl grammar and exports a pack entry that produces no fact kinds yet).\n\n1. Queries (packages/lang-terraform/queries/terraform/, found from the pack's own root like the Java and Go packs): resource and data blocks (type, name, span), module blocks (source, version), provider blocks, the terraform block (required_providers with versions, backend), variable, output and locals, and reference expressions (type.name.attribute, module.x.y, var.x, local.x). Provenance per rule, as the other packs record it.\n2. The in-memory model: resources with the attributes an audit needs (engine, engine_version, database_version, runtime, image, kubernetes/cluster version), module calls (local sources followed within the project; registry sources parsed into namespace/name/provider with version), provider versions from required_providers, and a reference graph. Detection-table entries (for example a registry module to a resource kind) carry provenance.\n3. Facts: the pack entry produces \"resources\" (a declared fact kind since PR 11). Extend lang-kit's ResourceFact with optional fields, additively and documented in pack-contract.ts: `module` (the module call path that declared the resource, e.g. `module.db`; absent at the root), `provider` (`{ name, version? }`, the version as written in required_providers), `references` (`<type>.<name>` of resources it references), `attributes` (`engine`, `engineVersion`, `runtime`, `image`, `clusterVersion`, each a string exactly as written, never normalised here). Move \"resources\" from DECLARED_FACT_KINDS to PRODUCED_FACT_KINDS and update the contract tests.\n4. Decision 8 (agreed with Sterling H): Terraform gets no zones (zones.ts keeps excluding Terraform), and in a Terraform-first repo, Terraform files under test paths keep the test role: give lang-kit's terraformConfig path-based test patterns (tests/ and test/ directories, plus .tftest.hcl) and add a test for a Terraform-primary fixture. This may change roles in Terraform-first repos only; TypeScript, Go and Java repos' output stays byte-identical.\n5. Goldens in packages/lang-terraform/tests cover resources, data sources, modules (local and registry), providers with versions, backend, variables, outputs, locals and references, plus audit attributes for RDS, Cloud SQL, Lambda or Cloud Functions, and EKS or GKE fixtures.\n6. Corpus: extend packages/sourcevision/scripts/tf-corpus-report.mjs with resources and modules per repository and the comparison with analyzers/infrastructure.ts's resources (the model must be a superset; list every difference). Append the numbers to this task's log.\n\nNot here: persisting anything (next task), database engines (the task after). analyzers/infrastructure.ts and IAC_KINDS stay untouched. No package.json dependency changes."
lastModified: "2026-10-15T05:58:49.630Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
