---
id: "1628608d-b507-49ce-96bf-a73cfe88f70d"
level: "task"
title: "Bundle v2 round trip moves unknown state.yaml keys into node frontmatter"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-15"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A v2 tree whose state.yaml row holds an undeclared key round-trips through rex export and rex import-bundle into an empty v2 tree with that key in state.yaml and not in the node's frontmatter (regression test)"
  - "The v2 fixture still round-trips byte-identically through export and import"
  - "A bundle that puts a declared state field in the intent position is still rejected or routed to state, never written as frontmatter"
description: "From the PR 15 adversarial review (task f0d39c6d, bundle envelope v2). Verdict: should-fix, medium. The format freezes at 1.0.0, so fix it before then.\n\nFailure: suppose a v2 tree has a state.yaml row holding a key this build does not declare in ItemStateSchema. That could be a retired field (appliedIn, specReviewed) or a field written by a newer rex at the same rex/v2 stamp. Run `rex export`, then `rex import-bundle` into another v2 tree. The key ends up in the node's Markdown frontmatter instead of state.yaml. Reproduced: futureField: \"x\" added to changes/add-apple-pay/state.yaml in the v2 fixture reappears in changes/add-apple-pay/index.md frontmatter after export and import.\n\nCause: the envelope stores each node as intent and state merged (packages/rex/src/store/prd-bundle-v2.ts, buildBundleV2). Import goes through writePrdModel. Its splitState (packages/rex/src/store/prd-model-writer.ts) treats a key as state only when it is declared, or when a state.yaml row on disk already holds it. A fresh destination has no such row. This is the same defect class as 908c0610 (\"Keep a moved node's unknown state fields in state.yaml\"), which fixed moves but cannot cover bundles.\n\nReachability: today only through hand-made or early-draft v2 trees, because the v2 store is not wired. It becomes routine once a newer rex adds a state field.\n\nOptions:\n(A, recommended) Carry each node's state row separately in the envelope, e.g. `{ ...intent, state: { ...row } }`. The exporter reads the rows, which needs a reader hook or a direct state.yaml walk. On import, pass the state keys to the writer, e.g. a WritePrdModelOptions hint mapping each node id to its state keys. Cost: an envelope shape change, made before 1.0.0, plus a small writer option. Risk: low.\n(B) Keep the node shape and add a per-node `stateKeys` list. Cost: smaller, but it leaves the envelope with two ways to say the same thing.\nDo not edit core/ or schema/v2*.\n\n## Decision and operator note (Ryan, 2026-10-08)\n\n- Option A. Fix it in the PR 15 branch, in envelope v2 itself: v2 has not shipped, so change its node shape in place (no envelope v3). v1 bundles must still import.\n- Keep the existing v2 round-trip test byte-identical, and update the PR 15 changeset (.changeset/bundle-envelope-v2.md) if the envelope description changes.\n- Lane: do not edit packages/rex/src/core/, packages/rex/src/schema/v2.ts or packages/rex/src/schema/v2-rules.ts. Work in packages/rex/src/store/ and packages/rex/src/cli/.\n- The sandbox pre-approves only npm, npx, node, git, tsc and vitest commands; use those forms (e.g. `npx vitest run --root packages/rex …`), never pnpm."
lastModified: "2026-10-08T07:18:52.478Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
