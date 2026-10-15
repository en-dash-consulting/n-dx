---
id: "05b34c7e-bd74-4bd4-8e40-d511a8b8f22d"
level: "feature"
title: "Terraform model in the Terraform pack and infrastructure.json (PR 13)"
status: "completed"
priority: "high"
tags:
  - "language-packs"
  - "terraform"
  - "lang-terraform"
  - "infrastructure"
  - "sourcevision"
  - "side-stack"
  - "pr-13"
blockedBy:
  - "6119e976-db18-4bb7-a1e1-ae6e40b7d197"
source: "roadmap"
startedAt: "2026-10-15T17:10:47.322Z"
completedAt: "2026-10-15T17:10:47.322Z"
endedAt: "2026-10-15T17:10:47.322Z"
acceptanceCriteria:
  - "@n-dx/lang-terraform's pack entry produces resources facts, and on the corpus its resources are a superset of infrastructure.ts's (differences listed by the corpus report)"
  - "With the Terraform pack installed, infrastructure.json on terraform-aws-rds and cloud-foundation-fabric differs from 12b's only by added optional fields on existing resources"
  - "Without the Terraform pack, every analysis artifact on the snapshot repos is byte-identical to 12b's"
  - "Terraform database resources are database-engine candidates with engine, version, evidence and grade"
  - "analyzers/infrastructure.ts, IAC_KINDS and the iso-map bundle are unchanged"
  - "The root policy suites pass"
description: "Step 2 of the order agreed with Sterling H (2026-10-12): the Terraform resource model and Terraform as a database-engine source, using decision 3's fields. The last PR of the language stack (PR 1–11, 12a, 12b, 13), which opens as one stack. Brief: workshop analysis/language-scaling/pr13-terraform-model-brief.md.\n\nDecided by Ryan 2026-10-15:\n- Persist additively. When @n-dx/lang-terraform is installed, Terraform resources that infrastructure.json already lists gain optional fields. Without the pack, infrastructure.json is byte-identical. The field names are proposals for Sterling H to review with the stack (decision 3 left field names and version normalisation to him).\n- Database engines: Terraform becomes a candidate source in memory. Persisting database resources with evidence-tagged links (all five signals) is a later PR.\n- Decision 8: no Terraform zones; in a Terraform-first repo, Terraform files under test paths keep the test role.\n\nThis supersedes the older Sterling H gate on c87df119 and 4cfaf841 (\"nothing new to infrastructure.json, do not edit infrastructure.ts\"): infrastructure.json gains optional fields in the persistence task. analyzers/infrastructure.ts and IAC_KINDS still stay untouched, so the iso-map bundle does not change; the enrichment is a separate engine-side step.\n\nArchitecture since 12a: the model lives in @n-dx/lang-terraform (packages/lang-terraform, which already ships the HCL grammar) and reaches sourcevision only as lang-kit facts, through the pack entry and pack-loader.ts. The Terraform pack is opt-in (`ndx sv pack add terraform`). No pack imports another pack. Agents cannot run `pnpm install`: no package.json dependency changes. Do not touch rex, hench, core or web source. No language SDK at run time (LS16). New guidance goes in package AGENTS.md files: the root AGENTS.md chain has ~119 bytes of headroom.\n\nCorpora: ~/.cache/ndx-iac-corpus/terraform-aws-rds and cloud-foundation-fabric; microservices-demo is in ~/.cache/ndx-go-corpus. Corpus scripts stay in packages/sourcevision/scripts and import packs from the workspace.\n\nThe bar: without the Terraform pack, every analysis artifact is byte-identical to 12b; with it, only Terraform repos change, and only by added optional fields on existing infrastructure resources (zones and links unchanged); Java, Go and SQL corpus numbers unchanged. Gates after every task (rebuild first): every lang-* suite and sourcevision; the root policy suites (architecture-policy, domain-isolation, instruction-alignment, layout-literal-policy, agents-md-size-budget, vitest-hidden-spawn-policy, prd-line-endings, ci-merge-queue-trigger, iso-skill-drift, shell-spawn-inventory-policy, wall-clock-inventory-policy, obfuscated-code-policy).\n\nSide stack, PR 13, cut from 12b's tip 9390919a4. Runs start unattended at 04:30 from ~/.local/share/ndx-scheduled/pr13-run.sh."
lastModified: "2026-10-15T17:10:47.626Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A listed but missing Terraform pack gives two notices per analyze in a Terraform repo](./a-listed-but-missing-terraform-pack.md) | completed |
| [Add the Terraform model as a database-engine source](./add-the-terraform-model-as-a-database.md) | completed |
| [database-corpus-report shows no Terraform candidates on terraform-aws-rds or cloud-foundation-fabric](./database-corpus-report-shows-no.md) | completed |
| [Terraform model build is quadratic in resources × reference edges](./terraform-model-build-is-quadratic-in.md) | completed |
| [Write Terraform structure queries and build the in-memory model](./write-terraform-structure-queries-and.md) | completed |
| [Write the Terraform model into infrastructure.json as optional fields](./write-the-terraform-model-into.md) | completed |
