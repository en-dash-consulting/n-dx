---
id: "181b0e6e-fec8-4b08-b31e-8dd1e8d9d692"
level: "task"
title: "`ndx iso` is dispatched but missing from COMMAND_REGISTRY, so typo suggestions and registry-driven checks never see it"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "core"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "getOrchestratorCommands() includes \"iso\""
  - "`ndx is .` lists `ndx iso` among its suggestions"
  - "KNOWN_UNREGISTERED in tests/e2e/command-docs-parity.test.js no longer contains \"iso\" and the suite passes"
  - "docs/guide/commands.md and the README Commands section each have an `ndx iso` row"
description: "Out-of-scope finding from the adversarial review of task ec5b4506. Pre-existing.\n\npackages/core/cli.js:3285 dispatches `iso` and help.js has an `iso` help entry (~line 1227), but COMMAND_REGISTRY (help.js:84) has no `iso` row, so getOrchestratorCommands() omits it.\n\nFailure scenario: `ndx is .` prints \"Did you mean one of: ndx ci, ndx fix, ndx sv?\" — the closest real command, `iso`, is never suggested (reproduced). Every registry-driven check is blind to it: command-docs-parity cannot require `ndx iso` in the command references, and command-effects coverage keyed to the registry does not cover it.\n\nSurfaced by the new reverse-direction test in tests/e2e/command-docs-parity.test.js, which carries `iso` in a KNOWN_UNREGISTERED set with a staleness check — that check fails once `iso` is registered, so the fix must remove the entry.\n\nFix (recommended, cheap): add an `iso` entry to COMMAND_REGISTRY with its summary, add the command-effects declaration if the registry test requires one, and delete `iso` from KNOWN_UNREGISTERED. Risk: low; check docs/guide/commands.md gains an `ndx iso` row, which the forward parity test will then demand."
lastModified: "2026-10-06T07:37:49.598Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
