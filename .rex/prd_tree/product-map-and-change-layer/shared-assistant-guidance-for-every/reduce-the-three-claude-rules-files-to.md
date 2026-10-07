---
id: "f2d64d8a-fd8d-49dc-a77f-691b9d3afcd1"
level: "task"
title: "Reduce the three .claude/rules files to pointers, removing the second copy of each registry"
status: "pending"
priority: "medium"
tags:
  - "documentation"
source: "Split out of task b88dba61 — blocked on an interactive approval a non-interactive run cannot obtain"
acceptanceCriteria:
  - "All three .claude/rules files are frontmatter plus a short pointer - no table rows, no rules list, no second copy of any registry"
  - "Neither injection-seam rule file tells authors to create a .claude/rules file for their own package; both point a new package registry at that package's AGENTS.md and cite packages/llm-client/ as the reference pair"
  - "instruction-alignment.test.js no longer pins the rule files against their AGENTS.md copies, and instead fails a rule file that carries a table row"
  - "TESTING.md and claude-addendum.md no longer describe a two-copy state; root AGENTS.md and CLAUDE.md regenerated"
  - "pnpm typecheck and the root test suite pass"
description: "Follow-up to \"Give every package CLAUDE.md an AGENTS.md counterpart\" (b88dba61).\n\nThat task moved every package's governance into AGENTS.md, including the bodies of the three .claude/rules files: web-gateway-boundary.md and web-injection-seams.md are now sections of packages/web/AGENTS.md, and core-injection-seams.md is packages/core/AGENTS.md. The rule files themselves were NOT rewritten: .claude/ is a protected path in Claude Code and every write (Write, Edit, and a Bash heredoc) was refused pending an interactive approval the run could not get. Do this one in a session where you can approve the prompt, or edit the three files by hand.\n\nSo there are two copies of each registry today. tests/e2e/instruction-alignment.test.js pins them together - pinnedAgainstDrift asserts every table row in a rule file appears verbatim in the AGENTS.md that owns it, and that each rule file's title heading has a matching section heading there - so they cannot silently diverge in the meantime. That guard is scaffolding for this task, not a permanent fixture.\n\nDo, for each of .claude/rules/core-injection-seams.md, web-injection-seams.md and web-gateway-boundary.md:\n1. Keep the YAML frontmatter paths: block exactly as it is - that path scoping is the only reason the file still exists.\n2. Replace the body with a short pointer: name the section and the file that holds it (e.g. the \"Web injection seam registry\" section in packages/web/AGENTS.md), note that the package CLAUDE.md imports it so Claude Code already has it loaded, and give a one-line reminder of what the registry covers.\n3. Delete the trailing paragraph in the two injection-seam files telling authors to create an analogous .claude/rules file for their package. A new package's registry goes in that package's own AGENTS.md with its CLAUDE.md reduced to the @AGENTS.md import; packages/llm-client/ is the reference pair.\n\nThen in tests/e2e/instruction-alignment.test.js, delete pinnedAgainstDrift and the two it.each blocks that use it, and replace them with: each rule file contains no table row at all, contains \"AGENTS.md\", and does not contain the package-placeholder injection-seams filename. Keep the existing \"no package beyond core and web has a .claude/rules seam registry\" test as is.\n\nFinally update the paragraph in TESTING.md under \"Where a table lives\" and the second paragraph of packages/core/assistant-assets/claude-addendum.md, both of which currently describe the two-copy state as temporary; regenerate the root files afterwards."
lastModified: "2026-10-06T23:11:42.457Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
