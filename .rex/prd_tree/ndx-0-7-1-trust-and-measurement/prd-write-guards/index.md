---
id: "d0da679c-d5c3-4d37-bc39-d16ab68deb49"
level: "feature"
title: "PRD write guards"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "prd-write-guards"
source: "caos work management: feature ndx 0.7.1 - PRD write guards (added 2026-09-21 after PR #382 exposed the slug-rule sweep)"
startedAt: "2026-09-21T22:15:57.303Z"
endedAt: "2026-09-22T00:47:25.310Z"
acceptanceCriteria:
  - "A branch carrying a non-conformant PRD path fails the CI PR check with the offending paths and the rex migrate-slugs instruction named."
  - ".rex/tree-meta.json records the slug rule version, and a rex build with a different rule version refuses every PRD write with a clear message; rex migrate-slugs is the only command that updates the marker."
  - "ndx work, including --dry-run, and the dashboard Execute route refuse to start on a non-conformant tree before any claim or write, and a conformant tree is unaffected."
  - "All three guards have tests, and this repository's tree passes them on main."
description: "On 2026-09-17 a pull request merged into main carrying 1,570 renamed PRD files: a build whose slug rule differed from the code on main had rewritten the tree, and CI let it through because rex validate reports a non-conformant tree at warning severity. After the tree was re-slugged once (PR #382), nothing stops the next mismatched writer. Three guards close that: validation and CI fail on a non-conformant tree; the tree records which slug rule wrote it and a build with a different rule refuses to write; and an autonomous run or a dashboard Execute refuses to start on a non-conformant tree, so a run can never be the sweeper. These land before the other 0.7.1 lanes open, because every lane is built by autonomous runs that write the PRD when they finish.\n\nGoal: a PRD tree that does not match the current slug rule is caught before it is written and before it is merged, in CI, in the CLI and in the dashboard."
lastModified: "2026-09-22T20:10:52.145Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Adopt a conformant unmarked tree with a notice instead of refusing it](./adopt-a-conformant-unmarked-tree-with.md) | completed |
| [Check the slug-rule marker direction inside the PRD lock in adoptSlugRule (both stores)](./check-the-slug-rule-marker-direction.md) | completed |
| [Detect an index.md whose Children table omits a child directory, after confirming whether it hides items](./detect-an-index-md-whose-children.md) | pending |
| [Fail rex validate and CI when the PRD tree does not match the slug rule](./fail-rex-validate-and-ci-when-the-prd.md) | completed |
| [Fix the slug-rule guard's false refusal on an unmarked tree and bound migrate-slugs to upgrades](./fix-the-slug-rule-guard-s-false.md) | completed |
| [Keep worktree agents' MCP PRD writes in their own worktree when a local-scope registration pins another path](./keep-worktree-agents-mcp-prd-writes-in.md) | pending |
| [Make the repo slug invariant test import source and check the marker](./make-the-repo-slug-invariant-test.md) | completed |
| [Offer to migrate a non-conformant tree at the gate, and stop rather than continue](./offer-to-migrate-a-non-conformant-tree.md) | pending |
| [Preserve unknown tree-meta keys and treat a missing marker as a failure once one has been adopted](./preserve-unknown-tree-meta-keys-and.md) | completed |
| [Re-run the slug-rule gate on every loop iteration](./re-run-the-slug-rule-gate-on-every.md) | completed |
| [Record the slug rule version in tree-meta.json and refuse writes from a build with a different rule](./record-the-slug-rule-version-in-tree.md) | completed |
| [Refuse to start ndx work or a dashboard Execute on a non-conformant PRD tree](./refuse-to-start-ndx-work-or-a.md) | completed |
| [Remove the dead omitSlugRuleMarker option or reach it from a CLI fixture](./remove-the-dead-omitslugrulemarker.md) | completed |
| [Report slugRuleRecorded in rex migrate-slugs JSON output](./report-slugrulerecorded-in-rex-migrate.md) | completed |
