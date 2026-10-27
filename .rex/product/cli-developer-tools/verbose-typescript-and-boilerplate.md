---
id: "6d9f3098-b7e8-4feb-8279-ec46b4b54958"
type: "capability"
title: "Verbose TypeScript and Boilerplate Pattern Simplification"
slug: "verbose-typescript-and-boilerplate"
statement: "The production TypeScript source states each operation in its concise form, without redundant type assertions, single-use intermediate variables, or hand-written copies of logic an existing utility in the codebase already provides."
criteria: [{"id":"c1","text":"The production TypeScript source shall not apply an `as X` type assertion to a value whose type control-flow narrowing already proves to be X."},{"id":"c2","text":"The production TypeScript source shall not declare a local variable that is used exactly once in the next statement with no logic in between."},{"id":"c3","text":"When an existing utility function in the codebase already provides some logic, a production call site shall call that utility rather than implement the logic by hand."},{"id":"c4","text":"A production call site that uses an existing utility shall call it directly, without a wrapper around it."}]
source: "smart-add"
---

Audit production TypeScript files for patterns that are demonstrably more verbose than necessary without adding type safety or clarity: redundant type assertions where the type is already narrowed, unnecessary intermediate single-use variables, and manually-expanded operations replaceable with a built-in or existing utility already present in the codebase. Replace each with the concise equivalent.
