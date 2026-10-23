---
id: "43a98ad8-a0e3-4d7e-9ccb-d8ad34fa4927"
type: "change"
title: "Keep Terraform files out of zone detection so a Terraform folder leaves a TypeScript repo's zones unchanged"
slug: "keep-terraform-files-out-of-zone"
intent: "Follow-up to e052cf8e (severity medium). Decision 3 (Ryan, 2026-10-11, with Sterling H's agreement): option 2, keep Terraform files out of zone scope in zones.ts.\n\nWhy. Decision 2 on e052cf8e assumed main zoned .tf files as language Other. It does not: main's inventory leaves Terraform files out entirely. Evidence (Terraform side session, 2026-10-11): the TS fixture from tests/integration/terraform-roles.test.ts plus tests/fixtures/infra/main.tf and tests/route.test.ts, analyzed with --fast.\n- main build (~/ndx-core/ndx-runner, 94408c27a): no Terraform in inventory.json; zones api, db, src, tests.\n- PR 9 (173edad6c) without Terraform: zones identical to main.\n- PR 9 with Terraform: a new \"infra\" zone of the four config-role files; src/index.ts moves from zone \"src\" into \"api\"; infra/tests/main.tftest.hcl and tests/fixtures/infra/main.tf join \"tests\", whose description becomes \"primarily Terraform, TypeScript\".\nSo adding Terraform to a TS repo changes production zone membership for TypeScript files, against the epic rule that output for existing languages must not change.\n\nChange. In zones.ts prepareScopeAndEdges, leave inventory files whose language is \"Terraform\" out of scopeFiles (and so out of every zone, production or test). Filter on the inventory's language, not on the .hcl extension, so other HCL files keep main's behaviour. Terraform stays in inventory.json with the roles e052cf8e set; only zone detection skips it. The structure model (c87df119) decides later whether Terraform gets zones of its own.\n\nGate (LS12/LS13): this decision authorizes the edit to zones.ts only. No edits to classify.ts, the enrichment code, analyzers/infrastructure.ts or IAC_KINDS; nothing writes infrastructure.json or outbound.json.\n\nVerification after the run (Terraform side session): re-run the main vs PR 9 comparison above; zones.json must be identical, descriptions included."
acceptanceCriteria:
  - "zones.ts prepareScopeAndEdges leaves inventory files with language Terraform out of zone scope; the filter is on language, not on the .hcl extension"
  - "terraform-roles.test.ts asserts zones.json is identical for the TS fixture with and without Terraform, where the Terraform set includes infra/*.tf, infra/prod.tfvars, infra/terragrunt.hcl, infra/tests/main.tftest.hcl and tests/fixtures/infra/main.tf"
  - "No zone, production or test, lists a Terraform file, and no zone description names Terraform"
  - "Terraform files stay in inventory.json with their e052cf8e roles; classifications.json stays identical with and without Terraform"
  - "A Terraform-primary fixture analyzes without error and its non-Terraform files are zoned as before"
  - "No edits to classify.ts, the enrichment code, analyzers/infrastructure.ts or IAC_KINDS; zones.ts is edited only in the scope filter"
  - "The sourcevision suite (SV_REQUIRE_GRAMMARS=1) and the static root policy tests pass"
touches:
  - "8b4b34af-ec1d-4593-8266-67e39928289c"
priority: "medium"
tags:
  - "terraform"
  - "sourcevision"
  - "zones"
source: "ndx-adversarial-review"
---
