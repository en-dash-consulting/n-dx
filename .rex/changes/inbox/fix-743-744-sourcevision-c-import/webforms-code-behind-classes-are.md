---
id: "90a082b6-eec8-442f-909d-868dbb6dff7b"
type: "task"
title: "WebForms code-behind classes are scoped to their page, not merged as partials across pages"
slug: "webforms-code-behind-classes-are"
description: "Retest of #743 on a 1,766-file WebForms site: Web Site projects compile each page's code-behind separately, so copy-pasted pages that each declare `partial class _RenderForm` / `_Default` / `DRAI_drai` are distinct classes. csharp-imports.ts indexes them as parts of one partial type and links every page to every other: 658 of 5,355 edges are code-behind → other code-behind, and 328 of 539 circular chains are code-behind-only. Fix in `buildCSharpImportGraph`: a type declared in a code-behind file (bound from markup by CodeFile/CodeBehind/Inherits, i.e. *.aspx.cs, *.ascx.cs, *.master.cs, *.ashx.cs, *.asmx.cs and their *.designer.cs) is page-scoped. Its parts pair only within the same page (X.aspx.cs + X.aspx.designer.cs); outside references to a page class name declared by several pages resolve to none of them. Partial merging across files still applies to App_Code / library classes."
acceptanceCriteria:
  - "Two pages whose code-behind files both declare `partial class _Default` produce no edge between those files and no circular chain."
  - "A page's X.aspx.cs and X.aspx.designer.cs parts still link to each other, and the markup links to its code-behind."
  - "A reference from another file to a page class name declared by more than one page yields no edge; a name declared by exactly one page still resolves."
  - "Partial classes outside code-behind files (App_Code, libraries) still link every part."
priority: "high"
tags:
  - "sourcevision"
  - "csharp"
  - "webforms"
source: "ndx-capture"
---
