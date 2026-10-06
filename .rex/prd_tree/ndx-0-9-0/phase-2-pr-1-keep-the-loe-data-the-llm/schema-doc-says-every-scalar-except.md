---
id: "7e304b53-6fda-4e54-af7b-8663fd9db638"
level: "task"
title: "Schema doc says every scalar except loe is written quoted, but booleans such as ready are written bare"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "docs"
  - "r0"
  - "task-prep"
  - "0.9.0"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Serializer contract item 16 in prd-folder-tree-schema.md states that booleans are written bare, loe as a bare number, other scalars quoted, objects as inline JSON"
description: "**This task is part of PR 1 of 4** (Prepare task phase 2, R0). Found by /ndx-adversarial-review of origin/main...feat/090-r0-loe-fidelity. Verdict: should-fix (severity low: docs drift introduced by this PR; one sentence).\n\n## Failure scenario\ndocs/architecture/prd-folder-tree-schema.md:829 (serializer contract item 16, added in 08ac96430) reads: \"Scalars are written as quoted strings, except `loe`, which is written as a bare number.\" But `emitYamlField` writes booleans bare (packages/rex/src/store/folder-tree-serializer.ts, the `typeof value === \"boolean\"` branch, e.g. `ready: true`, pinned by the \"ready as a real boolean\" round-trip test in packages/rex/tests/unit/store/folder-tree-serializer.test.ts). Someone writing a parser or a hand edit from this contract would quote booleans, and `asBoolean` would still accept them — but the contract is wrong.\n\n## Proposed solution\nChange the sentence to: strings and other scalars are written as quoted strings; booleans are written bare (`true`/`false`); `loe` is written as a bare number; object-valued fields as inline JSON. Docs only, no changeset needed.\n\n## Operator note\nCommands are pre-approved only when they START with npx, node, npm, git or vitest. Never prefix a command with `cd … &&`. From the project root, run:\n- `npx vitest run --root packages/<pkg> [paths]` for tests;\n- `npx tsc -p packages/<pkg>/tsconfig.json --noEmit` to typecheck (if npx cannot find tsc from the root, use `npm run typecheck --prefix packages/<pkg>`);\n- `npx vitest run tests/e2e tests/integration` for the root policy tests (gateway export caps, contract lists, wall-clock inventory).\ne2e tests that spawn a CLI need `npm run build --prefix packages/<pkg>` first. Add a patch changeset for each package, using its scoped name, only if non-test code changes."
lastModified: "2026-10-06T01:22:13.835Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
