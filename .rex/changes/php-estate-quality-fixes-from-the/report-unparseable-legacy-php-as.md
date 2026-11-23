---
id: "6157500a-21ac-43e6-8f18-723ba4e88ec0"
type: "task"
title: "Report unparseable legacy PHP as legacy syntax and recover its facts"
slug: "report-unparseable-legacy-php-as"
summary: "Stop reporting valid old PHP as broken files, and recover the links and calls those files contain, so legacy repositories aren't missing parts of their map."
description: "**Problem (real deep run, shape only).** Of 36 files the parse report flagged as syntax errors:\n- 26 use brace string offsets (`$s{0}`, removed in PHP 8);\n- 13 use short open tags (`<?`), which depend on `short_open_tag`;\n- about half are a copied-in library.\nThese are valid PHP 5, and PHP 8 migration blockers, not broken files. But tree-sitter-php can't parse them, so they lose their import and call facts.\n\n**Fix.**\n1. **Before parsing, rewrite the two constructs, keeping positions,** so byte offsets and line and column numbers are unchanged:\n   - `$x{expr}` brace offsets become `$x[expr]`, the same length, only where the grammar would otherwise error;\n   - a bare `<?` open tag becomes `<?php` and is re-padded, or the same-length rewrite is handled through position mapping. Don't touch `<?xml`, or `<?` inside strings and HTML.\n   - Record each rewrite as a legacy-syntax fact: construct, count and positions.\n2. **Change the parse report.** `summary.parseIssues` gains a `legacySyntax` kind, counted per construct (brace-offset, short-open-tag). Those files stop counting as syntax errors. Only real syntax errors stay under `syntax`.\n3. **Count the rewritten constructs** in the legacy-construct rules: `curly-offset` is removed in 8.0, and short tags are reported as an ini-dependent notice. They must not be double-counted with the existing rules (`9edf040a` added `$str{0}` detection).\n\n**Tests:** invented fixtures with brace offsets in expressions, assignments and strings (`\"{$x}\"` must not change), short tags beside `<?xml` and `<?=`, and a file mixing both with an include and a call. Assert:\n- the facts are recovered: includes, calls, symbols;\n- positions match the original source;\n- parseIssues reports `legacySyntax` and no syntax error;\n- legacy-construct counts appear once."
acceptanceCriteria:
  - "Files that fail to parse only because of brace offsets or short open tags produce their import, call and symbol facts, at positions matching the original source"
  - "parseIssues reports those files under legacySyntax, counted by construct, not as syntax errors"
  - "Brace-offset and short-tag uses are counted once in legacy constructs, and interpolation and <?xml are untouched"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "lang-php"
  - "legacy"
blockedBy:
  - "0508bb06-2369-418d-8e8e-f9f34fcee361"
---
