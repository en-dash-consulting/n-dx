---
id: "dc94c6ea-c087-4408-adcf-428da7636d51"
type: "change"
title: "Call graph covers C#, so god classes and methods are detected on .NET projects"
slug: "call-graph-covers-c-so-god-classes-and"
intent: "Follow-up from the #743 retest: analyzers/callgraph.ts only parses JS/TS, so C# god classes and god methods are never reported. Extend the call graph to .cs files, reusing the type index from csharp-imports.ts for callee resolution."
acceptanceCriteria:
  - "callgraph.json contains functions and call edges for .cs files."
  - "A C# method calling many distinct functions is reported by the god-function finding."
priority: "low"
tags:
  - "sourcevision"
  - "callgraph"
  - "csharp"
source: "ndx-capture"
---
