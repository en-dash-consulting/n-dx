---
id: "e052cf8e-0feb-48e5-9b39-3f5fc3856f4c"
type: "change"
title: "Inventoried .tf files change zones, classifications and enrichment for TypeScript/Go repos that contain Terraform"
slug: "inventoried-tf-files-change-zones"
intent: "Verdict: should-fix (adversarial review of 442fc751). Severity medium.\n\nHistory. Since 442fc751, inventory.ts maps .tf/.tfvars/terragrunt.hcl/.tftest.hcl to \"Terraform\". Decision 1 (Ryan, 2026-10-10, option 1) gave them role \"config\"; run 1bc89f33 (commit 80eff690b) did that, and classifications.json is now identical for a TS fixture with and without infra/*.tf (tests/integration/terraform-roles.test.ts). zones.json still differs, and the agent stopped as instructed.\n\nWhy zones still differ. zones.ts prepareScopeAndEdges builds zone scope from file extension (NON_IMPORTABLE_EXTENSIONS) and ignores role, so infra/*.tf forms its own zone. That predates Terraform support: on main, .tf was language Other and was zoned the same way. Enrichment is already safe: an all-config zone is structural (enrich.ts isStructuralZone) and is templated, not sent to the LLM.\n\nThe real regression. Inventory rule 0 (classifyRole, packages/sourcevision/src/analyzers/inventory.ts, \"0. Terraform ... is config\") runs before rule 1 (test patterns). So Terraform under a test path, for example tests/fixtures/infra/main.tf in a TS repo, moved from role \"test\" (main) to \"config\". It leaves test quarantine (zones.ts quarantineTests, keyed on role \"test\") and enters the production graph.\n\nDecision 2 (Ryan, 2026-10-11): accept main's pre-existing zoning of Terraform files. The baseline is main's output, not a run without .tf. Fix only the test-quarantine regression, in inventory.ts:\n- Move the Terraform rule after the test rule, so a Terraform file that matches the repository language's test patterns (TS: /(?:^|\\/)tests?\\//, __tests__/, .test., .spec.; Go: _test.go etc.) gets role \"test\", as on main.\n- Exception: Terraform's own pattern (terraformConfig.testFilePatterns, /\\.tftest\\.hcl$/) does not by itself make a file \"test\". A .tftest.hcl outside a test path stays \"config\" until the structure model (c87df119) decides its role; a .tftest.hcl under a test path is \"test\" like any other file there.\n- Every other Terraform file stays \"config\".\nNo edits to zones.ts, classify.ts, the enrichment code, analyzers/infrastructure.ts or IAC_KINDS (Sterling H's, LS12/LS13). Option 2 (excluding .tf from zone scope in zones.ts) is not chosen and would need Hal.\n\nVerification after the run (done by the Terraform side session, not the agent): analyze the test fixture with main's build (~/ndx-core/ndx-runner) and with this branch, and diff zones.json. Zone ids and file lists must match. Only the language named in zone descriptions may differ (\"Terraform\" where main said Other)."
acceptanceCriteria:
  - "Terraform files (.tf, .tfvars, terragrunt.hcl, .tftest.hcl) that match the repository language's test patterns get role test, as on main; for example tests/fixtures/infra/main.tf in a TypeScript repo"
  - "Terraform's own .tftest.hcl pattern does not by itself make a file test: a .tftest.hcl outside a test path keeps role config, in a TypeScript repo and in a Terraform-primary repo"
  - "Every other Terraform file keeps role config; the existing 'inventories every Terraform file as config' test is updated to the new rule rather than deleted"
  - "terraform-roles.test.ts gains a case with tests/fixtures/infra/main.tf in the TS fixture asserting it has role test and appears in no production zone (it is quarantined with the tests)"
  - "classifications.json stays identical for the TS fixture with and without infra/*.tf (the existing assertion keeps passing)"
  - "Unit tests in classifyRole's suite cover: Terraform under tests/, Terraform outside tests/, .tftest.hcl at the root, .tftest.hcl under tests/, in both a TypeScript and a Terraform-primary config"
  - "No edits to zones.ts, classify.ts, the enrichment code, analyzers/infrastructure.ts or IAC_KINDS"
  - "The sourcevision suite (SV_REQUIRE_GRAMMARS=1) and the static root policy tests pass"
touches:
  - "8b4b34af-ec1d-4593-8266-67e39928289c"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "terraform"
  - "sourcevision"
source: "ndx-adversarial-review"
---
