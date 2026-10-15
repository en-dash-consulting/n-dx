---
id: "30deb8ab-acfe-413c-9f17-09b47ba4adcb"
level: "epic"
title: "Fix · #743 #744 sourcevision: C# import graph and stale call-graph carry-over"
status: "completed"
priority: "high"
tags:
  - "fix"
  - "sourcevision"
source: "ndx-capture"
startedAt: "2026-10-15T01:56:35.573Z"
completedAt: "2026-10-15T01:56:35.573Z"
endedAt: "2026-10-15T01:56:35.573Z"
acceptanceCriteria:
  - "callgraph.json never contains a function or edge from a file absent from the current inventory, and no finding references an ignored file (#744)."
  - "A C# project produces file→file import edges through types and `using` directives, so zones carry real cohesion/coupling and structural findings run (#743)."
  - "A patch changeset for @n-dx/sourcevision references #743 and #744."
description: "Fixes en-dash-consulting/n-dx#743 and en-dash-consulting/n-dx#744. One PR for both.\n\n#744: the incremental branch of `analyzeCallGraph` (`packages/sourcevision/src/analyzers/callgraph.ts`, ~line 506) carries forward every previous function and edge whose file is not in `changedFiles`, without checking the file is still in the inventory. `fileSetChanged` comes from inventory stats (added/deleted vs the previous `inventory.json`), not from the previous call graph, so after `.sourcevisionignore` prunes the inventory in an earlier run the stale entries survive and produce false critical \"God function\" findings. `imports.ts` (~line 704) and `components.ts` (~line 683) use the same `prev + changedFiles + !fileSetChanged` pattern.\n\n#743: sourcevision has import resolvers for JS/TS (`analyzers/imports.ts`), Go (`go-imports.ts`) and Swift (`swift-imports.ts`) but none for C#. `.cs` files are inventoried as `C#` (`analyzers/inventory.ts`) but add no edges, so on .NET projects every zone reads cohesion/coupling 0, almost all findings are \"isolated files\", and the manifest reports `language: typescript`. Language detection lives in `src/language/detect.ts` (registry of per-language configs). C# has no file-level imports, so resolution goes through declared types and `using` directives; a regex/lexer pass is enough (no Roslyn). WebForms markup (`.aspx/.ascx/.ashx/.asmx`) is not inventoried.\n\nConventions: branch `fix/sourcevision-csharp-and-ignore`, from upstream main. Scoped tests: `pnpm --filter @n-dx/sourcevision exec vitest run <file>`. Build sourcevision after changing it. One patch changeset for `@n-dx/sourcevision`, written in the last task."
lastModified: "2026-10-15T01:56:35.886Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [C# import resolution through declared types and using directives](./c-import-resolution-through-declared.md) | completed |
| [C# is detected as the project language and WebForms markup links to its code](./c-is-detected-as-the-project-language.md) | completed |
| [Changeset and docs for the #743 #744 sourcevision fixes](./changeset-and-docs-for-the-743-744.md) | completed |
| [Incremental analyzers drop carried-over entries for files no longer in the inventory](./incremental-analyzers-drop-carried.md) | completed |
