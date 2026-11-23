---
id: "92dec474-92cc-43b3-aae6-196960f4458f"
type: "task"
title: "Port the shortened lead of .changeset/php-static-class-dispatch-property-provenance.md from 612011bd3"
slug: "port-the-shortened-lead-of-changeset"
summary: "Shortens the opening sentence of one release note so it meets the release-notes rule."
description: "Apply `git show 612011bd3 -- .changeset/php-static-class-dispatch-property-provenance.md` verbatim. Test from the root: `npx vitest run tests/e2e/changeset-body-policy.test.js`."
acceptanceCriteria:
  - "The changeset matches 612011bd3's version"
  - "changeset-body-policy passes"
priority: "high"
run: {"tier":"standard","skipTestGate":true}
---
