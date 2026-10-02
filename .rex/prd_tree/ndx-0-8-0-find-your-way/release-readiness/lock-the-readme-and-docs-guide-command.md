---
id: "e2969878-03e8-4ebf-8f6a-99279cf7f04d"
level: "task"
title: "Lock the README and docs/guide command references to the help registry"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "release-readiness"
  - "pr-26"
source: "0.8.0 PR B7 sidecar review, 2026-10-02: the README command reference named in 2d8ffe0a has no generator (packages/core/readme-generator.js writes the target project's README during ndx init, not n-dx's own)"
acceptanceCriteria:
  - "Every command returned by getOrchestratorCommands() appears in the README Commands section and in docs/guide/commands.md, apart from the documented delegation exemptions."
  - "A parity test fails when a registry command is missing from either file, and passes on the release commit."
  - "Existing README rows keep their hand-written flag text; only missing rows are added."
description: "The README \"## Commands\" tables and docs/guide/commands.md are hand-kept and nothing checks them against the orchestrator command registry in packages/core/help.js (COMMAND_REGISTRY, exposed by getOrchestratorCommands()). As of main 0bca3ea0f the README is missing `ndx which`, `ndx trust` and `ndx log`, and docs/guide/commands.md is missing `ndx claim`, `ndx which`, `ndx prd`, `ndx trust`, `ndx log` and `ndx tree-diff`.\n\nAdd the missing rows, writing each from the command's help.js summary and its ORCHESTRATOR_HELP_DEFS flags and matching the surrounding row style (README tables keep their richer hand-written flag text; do not replace existing rows with generated text). Then add a parity test that fails when a command returned by getOrchestratorCommands() appears in neither the README Commands section nor docs/guide/commands.md. The delegation entries `rex`, `hench`, `sourcevision` and `sv` are covered by the README's \"Direct Tool Access\" block; handle them with a small, commented exemption list in the test rather than by adding table rows.\n\nImplementation notes: run this after PR #505 merges (it edits packages/core/help.js and docs/guide/commands.md). Do not edit CLAUDE.md or AGENTS.md directly — they are generated from packages/core/assistant-assets/. If the edited README ships inside a published package, add a patch changeset with the scoped package name; a docs-only change to files outside every package needs none. Constraints that apply to every n-dx change: cross-package imports go only through the package's gateway module and tests/e2e/architecture-policy.test.js enforces an export ceiling on those gateways; orchestration scripts in packages/core spawn CLIs and never import packages; run pnpm preflight before opening the PR."
lastModified: "2026-10-02T17:01:46.536Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
