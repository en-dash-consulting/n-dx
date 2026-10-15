---
id: "1237abdc-e0d4-41f3-bae9-d004e55ca415"
level: "task"
title: "C# import resolution through declared types and using directives"
status: "pending"
priority: "critical"
tags:
  - "sourcevision"
  - "imports"
  - "csharp"
source: "ndx-capture"
acceptanceCriteria:
  - "A file referencing a type declared in another file of the same namespace gets an edge to that file."
  - "A `using Foo.Bar;` makes types declared in namespace Foo.Bar resolvable; `global using` applies to every file; `using X = Foo.Bar.Baz;` aliases resolve."
  - "File-scoped (`namespace X;`) and block namespaces are both indexed, and parent namespaces are visible from nested ones."
  - "A reference to a partial type yields an edge to every file declaring a part of it."
  - "Identifiers in comments and string literals produce no edges; unresolvable names (e.g. System types) produce no edges."
  - "An end-to-end analyze of a small C# fixture project produces a non-empty import graph."
description: "#743. New `analyzers/csharp-imports.ts`, dispatched from `analyzeImports` alongside Go and Swift. Lexer pass (strip comments and strings) per `.cs` file: index declared types with their namespace (block and file-scoped; class/interface/struct/record/enum, partial types across files); collect `using` / `global using` / alias directives and referenced type identifiers (base types, `new X`, generic args, static calls, attributes, declarations). Resolve each reference through the file's own namespace and its parents, global usings and its usings; emit file→file edges, one per declaring part for partial types. Skip self-edges and unresolved identifiers (BCL types)."
lastModified: "2026-10-15T01:44:14.407Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
