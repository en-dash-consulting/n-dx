---
id: "bab21760-66e1-404c-b7d4-d5165d727af4"
level: "task"
title: "tree-sitter-go 0.25.0 rejects Go 1.26 new(expr) and generic methods"
status: "pending"
priority: "low"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
source: "operator"
acceptanceCriteria:
  - "build-grammars.mjs GRAMMARS and goPack GRAMMAR_VERSION name the same tree-sitter-go release, which parses new(expr) and generic methods"
  - "The Go golden is regenerated and reviewed"
  - "go-corpus-report.mjs on gitea @89ec271d shows no unclean file caused by new(expr) or a generic method"
  - "The six static root policy tests pass"
description: "The Go corpus report (42d5dba1) found 41 of 3131 gitea files at 89ec271d with ERROR or MISSING nodes. About 37 use new with an expression operand (Go 1.26: new(time.Now()), new(\"x\")) and one declares a method with type parameters (services/context/context.go, func (ctx *Context) JSONError[T string | template.HTML]). The errors sit after the import block, so imports and the 98% gate hold (98.69%), but structure captures in those bodies are partial and the clean share will fall as more code adopts new(expr). Bump the GRAMMARS pin and goPack GRAMMAR_VERSION together once a tree-sitter-go release parses both, regenerate the Go golden, and re-run go-corpus-report.mjs."
lastModified: "2026-10-08T05:43:26.020Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
