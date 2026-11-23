---
id: "10dfeae3-e2f6-41c2-af1d-7bea7869d79e"
type: "change"
title: "PHP call graph from the pack's call facts"
slug: "php-call-graph-from-the-pack-s-call"
summary: "Feed the PHP pack's function and method call facts into callgraph.json, which today covers JavaScript and TypeScript only, so a PHP codebase gets a call graph too."
intent: "The PHP pack has produced call facts since PR 2 (queries/php, the calls kind), but nothing feeds them into the call-graph phase: on a real legacy PHP repository callgraph.json held only JavaScript functions while imports.json had thousands of PHP edges. Decide how PHP functions, methods and static calls map to callgraph.json's function and edge records (qualified names, include-scoped globals, dynamic dispatch left unresolved), wire the pack's facts through the language-pack path, and keep repositories without PHP byte-identical. Captured from the PR 12 estate-readiness work, 2026-11-16; not part of PR 12. Ryan decides whether to build it."
acceptanceCriteria:
  - "A PHP repository's callgraph.json lists its functions and methods and the calls between them"
  - "Repositories without PHP keep byte-identical callgraph.json"
priority: "medium"
---
