---
id: "f8e173a9-c7b8-4a53-83bd-a51d7f54fab8"
level: "task"
title: "Write the Terraform model into infrastructure.json as optional fields"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "terraform"
  - "infrastructure"
  - "sourcevision"
  - "pr-13"
blockedBy:
  - "c87df119-1d65-4f73-9675-a6f0b3b21858"
source: "roadmap"
startedAt: "2026-10-15T15:00:34.831Z"
completedAt: "2026-10-15T15:14:52.002Z"
endedAt: "2026-10-15T15:14:52.002Z"
resolutionType: "code-change"
resolutionDetail: "Terraform pack enriches listed infrastructure.json resources with optional module/provider/references/attributes; byte-identical without the pack; verified on both corpora."
acceptanceCriteria:
  - "InfraResource in schema/v1.ts has the optional module, provider, references and attributes fields, documented in the sourcevision docs"
  - "With the Terraform pack, infrastructure.json on terraform-aws-rds and cloud-foundation-fabric differs from the run without it only by added optional fields; zones.json and every other artifact are identical"
  - "Without the Terraform pack (and for repos without Terraform), every analysis artifact is byte-identical to before this task"
  - "`git diff HEAD~1 -- packages/sourcevision/src/analyzers/infrastructure.ts` is empty and `node scripts/build-iso-skill.mjs --check` passes"
  - "Enrichment tests cover id matching, no new resources or links, no changed fields and the absent pack"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Decision 3 (agreed with Sterling H) and Ryan's 2026-10-15 call: when @n-dx/lang-terraform is installed, the Terraform resources infrastructure.json already lists gain optional fields from the model. Additive only; Sterling H reviews the field names with the stack.\n\n1. Loading: add terraform to KNOWN_PACKS in packages/sourcevision/src/language/pack-loader.ts (opt-in, like Java: a missing pack means no enrichment and one notice only when the project has Terraform files; no new notice for a repo without Terraform). `sv pack list` stops marking terraform \"not analyzed yet\".\n2. Schema: packages/sourcevision/src/schema/v1.ts InfraResource gains optional `module?: string`, `provider?: { name: string; version?: string }`, `references?: string[]` (infrastructure ids, `infra:<type>.<name>`, of the referenced resources that infrastructure.json lists), `attributes?: { engine?: string; engineVersion?: string; runtime?: string; image?: string; clusterVersion?: string }`. Strings as written in the Terraform; no normalisation. Update any schema validation (zod) and the docs that describe infrastructure.json (docs/ and packages/sourcevision/AGENTS.md; not the root guidance).\n3. Enrichment: a new engine-side step (for example packages/sourcevision/src/analyzers/terraform-infrastructure.ts), called in src/cli/commands/analyze.ts after computeInfrastructure and before the file is written: it runs the Terraform pack over the inventory's Terraform files and adds the fields to resources whose id `infra:<type>.<name>` matches a resource fact. It never adds or removes a resource, a link or a seam, and never changes an existing field. Resources only the model finds stay out (the corpus report lists them). analyzers/infrastructure.ts and IAC_KINDS stay untouched, so the iso-map bundle is unchanged (`node scripts/build-iso-skill.mjs --check`).\n4. Canonical output: fields appear only when the pack supplied a value; toCanonicalJSON keeps the file byte-stable across runs.\n5. Tests: enrichment unit tests (match by id, no new resources, no field changes, absent pack = untouched); an analyze integration test on a Terraform fixture with and without the pack; the existing infrastructure, workspace-crossing and terraform-infrastructure-unchanged tests pass unedited.\n\nVerify on the corpus (append to this task's log): with the workspace's Terraform pack, run `sv analyze --fast` on copies of ~/.cache/ndx-iac-corpus/terraform-aws-rds and cloud-foundation-fabric, and diff infrastructure.json against a run with the Terraform pack disabled (inject a loader that reports it missing, or an empty pack dir plus an import that fails): the only differences are added optional fields; zones.json and every other artifact are identical. No package.json dependency changes. Do not touch rex, hench, core or web source."
lastModified: "2026-10-15T15:14:52.294Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
