---
id: "f2bfa3e5-ff03-4c8d-b294-5850185bb5a9"
type: "change"
title: "Synchronize project documentation with current CLI command surface"
slug: "synchronize-project-documentation-with"
intent: "Audit CLAUDE.md, CODEX.md, README files, and commands.md for command invocations, flag references, and workflow descriptions that no longer match the current CLI. Update all stale sections to reflect the actual command surface, remove references to removed commands, and add entries for commands added since the last documentation pass. Also verify that CLI --help output for each command matches the documented description."
acceptanceCriteria:
  - "Every command listed in CLAUDE.md Orchestration Commands and Direct Tool Access sections exists in the CLI and exits 0 with --help"
  - "All flag names and default values in documentation match current CLI behavior (verified by running --help against each)"
  - "No documentation section references commands or flags that have been removed or renamed"
  - "CODEX.md sections mirroring CLAUDE.md are updated in sync per the SYNC NOTICE at the top of CLAUDE.md"
  - "A CI assertion or documentation linting step is added (or an existing one is confirmed) that catches future doc/CLI divergence"
touches:
  - "6ba40421-b660-40fb-9c7d-70651bb863e1"
priority: "medium"
tags:
  - "docs"
  - "cli"
  - "dx"
source: "smart-add"
---
