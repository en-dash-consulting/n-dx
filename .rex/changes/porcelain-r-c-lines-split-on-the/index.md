---
id: "e84bdefa-797f-4073-8951-912c562c9c1e"
type: "change"
title: "Porcelain R/C lines split on the quoting git uses, so a path containing ' -> ' parses on either side"
slug: "porcelain-r-c-lines-split-on-the"
intent: "Two low findings the Opus review of 2ec844dd dropped. Ryan asked to fix them in PR #1004 (2026-11-06).\n\nFact, checked against git 2.x with `git status --porcelain --untracked-files=all`: git quotes every path that contains a space, so a path containing \" -> \" is always quoted:\n  R  \"src/has space.ts\" -> .rex/x/hs.ts\n  R  \"src/a -> b.ts\" -> .rex/x/moved.ts\n  R  src/plain.ts -> \".rex/x/p -> q.ts\"\n\n1. splitPorcelainPaths (packages/hench/src/store/artifacts.ts, ~282-296) splits an R/C line on the LAST \" -> \". The third line above therefore splits inside the quoted target: from becomes `src/plain.ts -> \".rex/x/p` and to becomes `q.ts\"`. Fix: split by quoting. If the path field starts with `\"`, read the quoted source up to its closing unescaped quote (a backslash escapes the next character), expect \" -> \" right after it, and the rest is the target. Otherwise the source is unquoted and has no space, so split at the FIRST \" -> \". Strip the surrounding quotes from each side as unquotePorcelainPath does today. Decoding C escapes inside quotes (\\\\\", \\\\\\\\, octal) is out of scope; leave that behaviour unchanged.\n\n2. The arrow test added by 2ec844dd (packages/hench/tests/unit/agent/lifecycle/uncommitted-work-gate.test.ts) feeds an unquoted `src/a -> b.ts -> .rex/...` line that git never produces. Change it to the quoted form git emits, and add unit tests in the hench store tests for parsePorcelainPath, porcelainSourcePath and matchesPorcelainLine on all three lines above, plus a plain unquoted rename. Keep every existing porcelain test green.\n\nOperator notes: touch only packages/hench; run the six static root policy tests before finishing (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code); add one @n-dx/hench patch changeset."
acceptanceCriteria:
  - "parsePorcelainPath and porcelainSourcePath read `R  src/plain.ts -> \".rex/x/p -> q.ts\"` as source src/plain.ts and target .rex/x/p -> q.ts (hench unit test)"
  - "They read `R  \"src/a -> b.ts\" -> .rex/x/moved.ts` as source src/a -> b.ts and target .rex/x/moved.ts, and `R  \"src/has space.ts\" -> .rex/x/hs.ts` likewise (hench unit test)"
  - "The uncommitted-work-gate arrow test uses the quoted line git emits and findUncommittedWork still names src/a -> b.ts in full"
  - "An unquoted rename `R  src/app.ts -> .rex/changes/x/app.ts` parses as before, and all existing porcelain tests stay green"
touches:
  - "9cea889f-17de-4b92-a97e-b7279e158578"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-adversarial-review"
---
