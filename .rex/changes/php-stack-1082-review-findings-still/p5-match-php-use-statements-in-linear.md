---
id: "135ce8f7-f173-4382-8d6b-71308fec7f75"
type: "task"
title: "P5: match PHP use statements in linear time"
slug: "p5-match-php-use-statements-in-linear"
summary: "Stops files with many import lines from taking seconds each to read."
description: "#1082 review P5 (medium), `packages/lang-php/src/php-imports.ts` (around lines 65–88 at review time).\n\nFor each declaration it scans every clause, and for each clause re-runs `named(...)` / `innermost(...)`: cubic. Measured: 1,000 `use` statements in one 20 KB file take 7.5 s for `readWrittenImports` and 15 s for `preparePhpImports` (about 1.4 s at 500). It runs about three times per file (resolver, autoloaders, dynamic-code).\n\nFix: use lang-runtime's linear `innermostEach` (or an equivalent single pass), and compute the use table once per file for all three consumers if that is a small change.\n\nTests: imports identical on existing fixtures; a generated file with 2,000 `use` statements reads in well under a second (generous bound), skipped when the grammar is not built."
acceptanceCriteria:
  - "use-statement matching is linear in the file"
  - "Imports are identical on existing fixtures"
priority: "medium"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "performance"
---
