---
id: "8b4b34af-ec1d-4593-8266-67e39928289c"
level: "feature"
title: "Terraform structure through tree-sitter-hcl"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "terraform"
  - "sourcevision"
  - "side-stack"
  - "pr-8"
blockedBy:
  - "2fc859c0-090f-43bb-b1b4-36415478bae8"
source: "roadmap"
acceptanceCriteria:
  - "The HCL grammar builds and Terraform files parse with at least 98% clean on the corpus"
  - "The in-memory model lists resources, data sources, modules, providers and references, and finds every resource infrastructure.ts finds"
  - "infrastructure.ts, IAC_KINDS and infrastructure.json are unchanged"
  - "The six static root policy tests pass"
description: "LS12: Terraform becomes a language pack whose detail will extend Sterling H's infrastructure.json (analyzers/infrastructure.ts, which today extracts resource blocks with a regex and maps types to coarse kinds via IAC_KINDS). In this PR the Terraform model stays in memory: nothing is written to infrastructure.json until the conversation with Sterling H. infrastructure.ts and IAC_KINDS are not edited.\n\nSide stack, PR 8."
lastModified: "2026-10-08T03:09:05.680Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add the missing changeset for Terraform files entering the inventory](./add-the-missing-changeset-for.md) | completed |
| [Build the HCL grammar and recognise Terraform files](./build-the-hcl-grammar-and-recognise.md) | completed |
| [Inventoried .tf files change zones, classifications and enrichment for TypeScript/Go repos that contain Terraform](./inventoried-tf-files-change-zones.md) | completed |
| [Keep Terraform files out of zone detection so a Terraform folder leaves a TypeScript repo's zones unchanged](./keep-terraform-files-out-of-zone.md) | completed |
| [Seed the Terraform drift corpus and measure parse rate](./seed-the-terraform-drift-corpus-and.md) | completed |
| [Terraform files deeper than three directories are inventoried but not detected](./terraform-files-deeper-than-three.md) | pending |
| [terragrunt.hcl and .tfvars are inventoried as Terraform in repos where detection finds no Terraform](./terragrunt-hcl-and-tfvars-are.md) | completed |
| [The Terraform file set is defined three times and can drift between detection and inventory](./the-terraform-file-set-is-defined.md) | pending |
| [Write Terraform structure queries and build the in-memory model](./write-terraform-structure-queries-and.md) | pending |
