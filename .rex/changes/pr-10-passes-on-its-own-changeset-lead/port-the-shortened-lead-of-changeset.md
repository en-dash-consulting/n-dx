---
id: "bf473ad6-1dbd-4056-89b7-34536bfaf805"
type: "task"
title: "Port the shortened lead of .changeset/php-dynamic-code.md from 612011bd3"
slug: "port-the-shortened-lead-of-changeset"
summary: "Shortens the opening sentence of one release note so it meets the release-notes rule."
description: "Apply `git show 612011bd3 -- .changeset/php-dynamic-code.md` verbatim. Test from the root: `npx vitest run tests/e2e/changeset-body-policy.test.js`."
acceptanceCriteria:
  - "The changeset matches 612011bd3's version"
  - "changeset-body-policy passes"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
