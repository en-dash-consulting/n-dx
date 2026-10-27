---
id: "1dc095d8-3394-4fb5-9c96-6601d408e57e"
type: "task"
title: "C# is detected as the project language and WebForms markup links to its code"
slug: "c-is-detected-as-the-project-language"
description: "#743 follow-through. Add a C# language config in `src/language/` (markers `*.sln`, `*.csproj`; skip `bin/`, `obj/`, `packages/`; test patterns) registered in `detect.ts`, so a mostly-C# project is not reported as `typescript` when a stray `package.json` exists — pick by authored source weight. Inventory `.aspx/.ascx/.ashx/.asmx/.master` and resolve WebForms directives: `Inherits=`/`CodeBehind=`/`CodeFile=` → code-behind edge, `<%@ Register Src= %>` → control edge, `.ashx/.asmx` `Class=` → handler class file."
acceptanceCriteria:
  - "A project with a .sln/.csproj and mostly .cs sources is detected as csharp (manifest language), including when a package.json is also present but JS/TS files are a minority."
  - "`csharp` is accepted as the `.n-dx.json` language override."
  - ".aspx/.ascx/.ashx/.asmx/.master files are inventoried."
  - "A page's CodeBehind/CodeFile directive yields an edge to the code-behind file; Register Src yields an edge to the user control; an .ashx Class= yields an edge to the declaring .cs file."
priority: "medium"
tags:
  - "sourcevision"
  - "csharp"
  - "language-detection"
source: "ndx-capture"
blockedBy:
  - "1237abdc-e0d4-41f3-bae9-d004e55ca415"
---
