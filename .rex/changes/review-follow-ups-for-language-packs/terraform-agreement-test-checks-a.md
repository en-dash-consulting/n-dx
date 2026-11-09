---
id: "beb90979-827d-40a1-80ac-a9b82edeca09"
type: "task"
title: "Terraform agreement test checks a fixed name list, so a new config filename can drift from isTerraformPath"
slug: "terraform-agreement-test-checks-a"
description: "From the Opus review of run dbf185a1 (task 779b0c9c, commit ef6005931); the reviewer rated it low / not worth fixing and dropped it. It is placed here so the reasoning is kept. packages/sourcevision/tests/unit/language/terraform-config.test.ts ('one Terraform file set') iterates a hand-written list of names. If a new name is added to terraformConfig.configFilenames (or a new pattern) without a matching edit to that list, detection and the inventory still agree, because both call isTerraformFile. isTerraformPath in analyzers/infrastructure.ts keeps its own copy, though, and nothing would fail when it disagrees. A cheap test-only fix: add every entry of terraformConfig.configFilenames, plus an upper-case variant, to the list the test iterates. Patterns cannot be enumerated this way. Test-only, so no edit to infrastructure.ts and no new Hal decision. Pick it up with the next change to the Terraform file set."
acceptanceCriteria:
  - "The agreement test's names include every terraformConfig.configFilenames entry and an upper-case variant of each, derived from the config rather than hand-copied"
  - "Only tests/unit/language/terraform-config.test.ts changes"
priority: "low"
source: "review"
---
