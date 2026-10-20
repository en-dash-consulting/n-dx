---
id: "d39918ef-23c1-4283-a8fc-3e83ff7d3597"
level: "task"
title: "Make the Spring Boot name and route-path helpers linear on any input"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "codeql"
  - "lang-java"
  - "pr-21"
source: "review"
startedAt: "2026-10-20T17:00:37.147Z"
completedAt: "2026-10-20T17:05:54.977Z"
endedAt: "2026-10-20T17:05:54.977Z"
acceptanceCriteria:
  - "simpleName and joinRoutePath return the same results as before for every existing test and the new equivalence cases"
  - "Both helpers finish within the callWithinBudget budget on 1 MiB adversarial inputs (many < with no >; many / then a non-slash)"
  - "No regex in spring-boot.ts is flagged by CodeQL js/polynomial-redos"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "**should-fix (CodeQL js/polynomial-redos on #788).** Alerts: https://github.com/en-dash-consulting/n-dx/pull/788 (spring-boot.ts lines 79 and 224 at that PR).\n\nAt the PR 21 tip, `packages/lang-java/src/spring-boot.ts`:\n- line 79, `simpleName`: `text.replace(/<[\\s\\S]*>/, \"\")` is quadratic on text with many `<` and no `>` (40,000 `<` take about 0.7 s; the input is capture text from the repository being analysed).\n- line 237, `joinRoutePath`: `prefix.replace(/\\/+$/, \"\")` is quadratic on many `/` followed by another character (40,000 take about 0.7 s).\n\nFix, keeping results identical: in `simpleName`, cut from the first `<` to the last `>` after it with `indexOf`/`lastIndexOf` (what the greedy regex removes); in `joinRoutePath`, trim trailing `/` with a loop over `charCodeAt` (or a small shared helper) instead of `/\\/+$/`. Leave `/^\\/+/` alone (anchored at the start, linear). Add tests that run under `callWithinBudget` (packages/lang-kit/tests/helpers/call-within-budget.ts, from the #825 hardening; it is a lang-kit test helper, so reuse it the way that package's test conventions allow, or add the same worker-with-a-budget helper to this package's tests) on the adversarial inputs, plus equivalence cases (nested generics `Map<String, List<X>>`, arrays, qualified names; empty, `/`-only and multi-slash prefixes). Add a `@n-dx/lang-java` patch changeset."
lastModified: "2026-10-20T17:05:55.295Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
