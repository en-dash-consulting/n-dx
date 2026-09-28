---
id: "7e4c8382-721c-4b45-a407-90ef97af2afb"
level: "task"
title: "Add ndx migrate-layout to move an existing project to .ndx/"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "layout-resolver"
  - "pr-21"
blockedBy:
  - "9a09a196-c686-43a2-a55a-d463d36da077"
  - "2c1bbdff-8e48-4769-9f4b-f2c59a2c54fe"
source: "caos work management: WM-2156 (Add ndx migrate-layout to move an existing project to .ndx/); 0.8.0 planning, PR 21 · Layout: init and migrate-layout"
acceptanceCriteria:
  - "ndx migrate-layout on this repository yields a commit that is renames plus two dotfiles."
  - "rex validate, ndx status and the dashboard cache are identical before and after; a second run is a no-op."
  - "A failed verification restores the snapshot."
  - "Every package's test suite passes on both layouts."
description: "ndx migrate-layout moves an existing project when the operator chooses: snapshot, git mv the tracked paths so history follows, move the untracked state, rewrite the .gitignore and .gitattributes blocks, verify, or restore.\n\nImplementation notes: Implement in packages/core (orchestration: spawn git and the package CLIs, never import packages); reuse packages/core/gitignore.js and gitattributes-pins.js for the block rewrites. Task claims stay in the git common directory. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module (hench: src/prd/rex-gateway.ts and src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts and src/server/domain-gateway.ts) and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; every user-facing change carries a changeset using the scoped package name (@n-dx/hench, @n-dx/rex, @n-dx/web, @n-dx/core, @n-dx/sourcevision, @n-dx/llm-client) with a patch bump; run pnpm preflight before opening the PR."
lastModified: "2026-09-25T18:12:46.000Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
