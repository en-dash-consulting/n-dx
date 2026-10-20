---
id: "07169f54-62f5-48e5-b3c1-1119a37b3d0b"
level: "task"
title: "Make the Java resolver's dotted-name reader linear on any input"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "codeql"
  - "lang-java"
  - "pr-21"
source: "review"
acceptanceCriteria:
  - "dottedSegments returns the same result as the old implementation for every existing test and for a randomized equivalence test over comment and bracket characters"
  - "dottedSegments finishes within the callWithinBudget budget on 1 MiB of unterminated comments and on 1 MiB of nested generics"
  - "CodeQL alert 73 (js/polynomial-redos at java-resolver.ts) no longer appears on the PR"
  - "Java goldens and the Java corpus report are unchanged"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave the Java corpus report to the session and do not capture follow-ups for it."}
description: "**should-fix (CodeQL js/polynomial-redos, alert 73 on #823 and #832).** Alert: packages/lang-java/src/java-resolver.ts:109.\n\nAt the PR 21 tip, `dottedSegments` in `packages/lang-java/src/java-resolver.ts` (lines 108-119) reads capture text from the repository being analysed and has two quadratic steps:\n- comment stripping, `/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*/g`: each unterminated `/*` scans to the end of the text (`\"/*\" + \"a/*\"` × 20,000 takes about 175 ms; CodeQL flags it).\n- generic erasure, a loop of `replace(/<[^<>]*>/g, \"\")` until nothing changes: one pass per nesting level, so deep nesting is quadratic (`\"<\"` × 20,000 + `\">\"` × 20,000 takes about 1 s; not flagged, same class).\n\nFix, keeping results identical for every input: strip comments in one left-to-right scan. At a `/*`, find the next `*/` with `indexOf`; once a search returns -1 there is no later `*/`, so remember that and stop searching (an unterminated `/*` is kept as text, as the regex leaves it). At a `//`, skip to the next newline. Erase generics in one pass with a depth counter that drops every character inside balanced `<…>` and keeps unbalanced brackets exactly as the loop would; check that against the old function with a property-style test over random strings of `<`, `>`, `/`, `*`, newlines and letters. Add tests under `callWithinBudget` (packages/lang-kit/tests/helpers/call-within-budget.ts, as the Spring Boot linearity test in this PR uses it) on both adversarial inputs at 1 MiB. Add a `@n-dx/lang-java` patch changeset."
lastModified: "2026-10-20T18:48:27.357Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
