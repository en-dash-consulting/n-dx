---
id: "66e1a9f2-49d3-4320-8363-ea8414d44ab9"
type: "change"
title: "Go calls query leaves string arguments of unnamed calls without an owning argument list"
slug: "go-calls-query-leaves-string-arguments"
intent: "Verdict: should-fix (low). Found by adversarial review of f817ad86.\n\npackages/sourcevision/src/language/queries/go/calls.scm captures @call.arguments only for calls whose function is an identifier or a selector, but @call.string_argument for every call_expression. A call whose function is anything else — `f()(\"z\")`, `handlers[k](\"z\")`, `(fn)(\"z\")`, an explicitly instantiated generic `pkg.F[int](\"z\")` — yields a string argument with no @call.arguments of its own. The documented pairing rule (innermost @call.arguments containing it) then attributes it to the enclosing call: `log(f()(\"z\"))` gives \"z\" to log.\n\nReachability: no consumer reads Go call captures yet (the pack is structure-only); first consumer will be route/outbound detection on the Go pack.\n\nOptions: (a) add a third pattern `(call_expression function: [...other kinds] arguments: (argument_list) @call.arguments) @call.invocation` with no @call.name — cheap, keeps the pairing rule true; recommended. (b) restrict @call.string_argument to calls with a name — loses those strings. Also check Java calls.scm for the same pattern shape.\n\nPlacement (2026-10-08): moved from PR 6 to review follow-ups. Land it before bb36a688 (PR 9, embedded SQL in Java and Go), which is the first code to pair Go @call.string_argument with its call; fixing it then needs the Go golden regenerated."
acceptanceCriteria:
  - "go-pack-queries.test.ts asserts that in `log(f()(\"z\"))` the innermost @call.arguments containing \"z\" is `(\"z\")`, not log's list"
  - "Every @call.string_argument in the Go goldens lies inside a @call.arguments that belongs to its own call"
touches:
  - "d8fccdeb-f9b5-4da2-be41-c5594fa0451f"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "go"
  - "language-packs"
source: "ndx-adversarial-review"
---
