---
"@n-dx/sourcevision": patch
---

C# projects get a real import graph (#743). `.cs` files are resolved through the types they declare and the `using` directives that bring them into scope: block and file-scoped namespaces, `partial` types across files, `global using`, `using static`, aliases and attribute names all resolve to the declaring file. ASP.NET WebForms markup (`.aspx`, `.ascx`, `.master`, `.ashx`, `.asmx`) is inventoried and linked to its code-behind, master page, registered user controls and `Inherits`/`Class` type. A `*.sln` or `*.csproj` within three levels of the root marks a C# project, `csharp` is accepted as the `language` override, and when several languages are present the primary is chosen by counting source files three levels deep rather than at the top level only, ignoring minified JavaScript.

Incremental analysis no longer carries forward call-graph functions and edges, import edges, or component definitions from files that have left the inventory (#744). A path added to `.sourcevisionignore` after an earlier analysis was not a deletion against the previous inventory, so its stale entries survived and produced false critical "God function" findings about ignored files.
