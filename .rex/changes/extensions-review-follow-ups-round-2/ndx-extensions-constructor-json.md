---
id: "3798c6e4-317b-4fe9-8aeb-41491e0def28"
type: "task"
title: "ndx extensions constructor --json crashes with a TypeError"
slug: "ndx-extensions-constructor-json"
description: "Verdict: should-fix (trivial). packages/core/extensions-command.js:104 reads SUBCOMMAND_FLAGS[sub] ?? [], which for an inherited name such as constructor or toString yields a function, so .includes throws and the CLI exits 1 with a formatted TypeError instead of reporting an unknown subcommand. Fix: Object.hasOwn(SUBCOMMAND_FLAGS, sub) ? SUBCOMMAND_FLAGS[sub] : []."
acceptanceCriteria:
  - "ndx extensions constructor --json and toString --json report an unknown subcommand, covered by a test"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
