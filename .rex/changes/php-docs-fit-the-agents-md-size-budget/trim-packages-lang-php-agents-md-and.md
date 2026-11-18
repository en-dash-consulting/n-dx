---
id: "ffd82261-2a28-4400-8a54-c179dbd09d88"
type: "task"
title: "Trim packages/lang-php/AGENTS.md and packages/sourcevision/AGENTS.md under the Codex chain budget"
slug: "trim-packages-lang-php-agents-md-and"
summary: "Shortens the PHP pack's and sourcevision's assistant notes so an assistant reads them in full, moving the detail into the package docs."
description: "`tests/e2e/agents-md-size-budget.test.js` caps root AGENTS.md + a package's AGENTS.md at 30,720 bytes per chain. Root is 20,323 bytes and is generated (do not edit it). Bring `packages/lang-php/AGENTS.md` (10,938 bytes; at least 541 over) and `packages/sourcevision/AGENTS.md` (10,364 bytes; 33 bytes of headroom) each to at most 9,373 bytes, so both chains have at least 1,024 bytes of headroom.\n\nHow: keep each AGENTS.md as rules and pointers (what an assistant must not break, where things live, which test enforces what). Move explanatory detail (field-by-field descriptions, corpus-script walkthroughs, examples) into the package's docs page, `docs/packages/lang-php.md` if it exists, otherwise the PHP or pack sections of `docs/packages/sourcevision.md`, and link it from AGENTS.md. Nothing may be dropped: every fact removed from an AGENTS.md must appear in docs/. Keep headings the instruction-alignment test and `.claude/rules/` pointers reference (run `tests/e2e/instruction-alignment.test.js`). Do not change the root AGENTS.md, CLAUDE.md files, the budget or the test. The docs move must not break `tests/e2e/docs-command-refs.test.js` (write folder or function names that look like `verb_noun` outside code spans, or as calls).\n\nVerify from the repository root: `npx vitest run tests/e2e/agents-md-size-budget.test.js tests/e2e/instruction-alignment.test.js tests/e2e/docs-command-refs.test.js` (the last may still fail on `edit_area` until the sibling task lands; no other new failure)."
acceptanceCriteria:
  - "packages/lang-php/AGENTS.md and packages/sourcevision/AGENTS.md are each at most 9,373 bytes"
  - "Every fact removed from them is present in docs/ and linked from the AGENTS.md"
  - "agents-md-size-budget and instruction-alignment tests pass; root AGENTS.md, the budget and the tests are unchanged"
priority: "high"
run: {"tier":"standard","review":true,"skipTestGate":true}
---
