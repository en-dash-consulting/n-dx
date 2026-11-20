---
id: "70795381-c8f5-49f5-bdd4-c90bb9b7dca9"
type: "task"
title: "Shorten the lead of php-marker-one-folder-down-keeps-fallback.md to 30 words"
slug: "shorten-the-lead-of-php-marker-one"
summary: "A release note's opening sentence grew past the release-notes limit, so the changeset check fails."
description: "tests/e2e/changeset-body-policy.test.js fails after 4c60cccdf (task 30758b33): '.changeset/php-marker-one-folder-down-keeps-fallback.md: lead sentence is 33 words; keep it to 30 or fewer and move mechanism to a later paragraph'. Rewrite the first paragraph to 30 words or fewer per .claude/skills/ndx-release-notes/SKILL.md, moving the Python example to the second paragraph if needed. Change only that changeset. Test from the root: npx vitest run tests/e2e/changeset-body-policy.test.js."
acceptanceCriteria:
  - "changeset-body-policy passes"
  - "Only that changeset changes"
priority: "high"
---
