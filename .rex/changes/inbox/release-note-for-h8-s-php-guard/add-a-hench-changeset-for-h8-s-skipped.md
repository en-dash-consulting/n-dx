---
id: "34e95b8a-299f-4e48-8b5d-6ac8b0be5f68"
type: "task"
title: "Add a hench changeset for H8's skipped-guard reporting and ./ paths"
slug: "add-a-hench-changeset-for-h8-s-skipped"
summary: "Writes the release note for the PHP guard fixes that missed 0.10.5."
description: "Create .changeset/hench-php-guards-skipped-report.md with frontmatter \"@n-dx/hench\": patch only (H8's commits touched only packages/hench). Describe only what H8 adds over the 0.10.5 entry (packages/hench/CHANGELOG.md, the PHP guards note): a run whose every PHP guard was skipped now reports them as skipped, with the reasons, not as passed; when one check ran and another was skipped, the event says how many were skipped and why; changed paths reach php -l as ./<path>, so a file named like an option (-zx.php) is linted. Follow .claude/skills/ndx-release-notes/SKILL.md; the lead sentence must be 30 words or fewer. Do not edit CHANGELOG.md or any other file. Test from the root: npx vitest run tests/e2e/changeset-body-policy.test.js."
acceptanceCriteria:
  - "The new changeset names only @n-dx/hench, patch"
  - "It describes only the all-skipped report, the partial-skip count and reasons, and the ./ paths"
  - "changeset-body-policy passes"
priority: "high"
---
