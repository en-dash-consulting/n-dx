---
id: "53d7c570-7aca-49b9-b265-a2228a6dc894"
type: "task"
title: "Go and SQL pack grammar versions are not tied to the build pin"
slug: "go-and-sql-pack-grammar-versions-are"
description: "go-pack.ts (0.25.0) and sql-pack.ts (0.3.11) hardcode GRAMMAR_VERSION and provenance verifiedAgainst separately from GRAMMARS in scripts/build-grammars.mjs. The Java pack now has java-grammar-pin.test.ts; Go and SQL have no equivalent, so a pin bump leaves their provenance stale with no failing test."
acceptanceCriteria:
  - "A test fails when goPack.grammar.version differs from GRAMMARS['tree-sitter-go'].version"
  - "A test fails when sqlPack.grammar.version differs from GRAMMARS['tree-sitter-sql'].version"
  - "A test fails when a Go or SQL provenance verifiedAgainst entry names a grammar version other than the pinned one"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
