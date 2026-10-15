---
"@n-dx/sourcevision": patch
---

C# projects get a real import graph (#743). `.cs` files are resolved through the types they declare and the `using` directives that bring them into scope: block and file-scoped namespaces, `partial` types across files, `global using`, `using static`, aliases and attribute names all resolve to the declaring file. ASP.NET WebForms markup (`.aspx`, `.ascx`, `.master`, `.ashx`, `.asmx`) is inventoried and linked to its code-behind, master page, registered user controls and `Inherits`/`Class` type. A `*.sln` or `*.csproj` within three levels of the root marks a C# project, `csharp` is accepted as the `language` override, and when several languages are present the primary is chosen by counting source files three levels deep rather than at the top level only, ignoring minified JavaScript.

Incremental analysis no longer carries forward call-graph functions and edges, import edges, or component definitions from files that have left the inventory (#744). A path added to `.sourcevisionignore` after an earlier analysis was not a deletion against the previous inventory, so its stale entries survived and produced false critical "God function" findings about ignored files.

WebForms code-behind classes are scoped to their page. Copy-pasted pages that each declare `partial class _Default` are separate classes in a Web Site project, so they no longer link to each other or form false circular chains; a page's own `.aspx.cs` and `.aspx.designer.cs` parts still pair, and partial classes elsewhere still link every part.

Zone detection damps files imported by a large share of the project (base pages, data services, shared models), so feature folders that all lean on the same hubs are zoned by folder rather than by who uses the hub. The zone algorithm version is bumped, so existing partitions are re-derived. A first analysis now records a partition review, and a zone holding more than half the files is reported even when its sub-zones are balanced.

Findings from earlier enrichment passes are no longer dropped by later ones. Content hashes were keyed to the enriched zone ids by array position, which put each hash under another zone's id whenever enrichment reordered zones; every carried global finding then read as stale.

The isometric map zooms faster on a trackpad pinch and slightly faster on ⌘/Ctrl + scroll; no single wheel event zooms more than 2×.
