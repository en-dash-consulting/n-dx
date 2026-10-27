---
id: "9b692c8a-208f-4676-952e-1674631a3a4c"
type: "task"
title: "Consolidate the duplicate go.mod parser (rex parseGoMod and sourcevision go-build)"
slug: "consolidate-the-duplicate-go-mod"
description: "rex/src/analyze/scanners.ts parseGoMod and sourcevision/src/language/go-build.ts parseGoMod both parse go.mod. Domain packages may not import each other, so the parser is duplicated. Consolidate into one implementation and delete one copy. Needs a decision on where shared parsing belongs.\n\nBlocked on LS7: domain packages may not import each other, and a go.mod parser does not belong in @n-dx/llm-client. Lands with the @n-dx/lang-kit extraction after roadmap PR 24, which will also merge the other duplicated build-file and language-identity code (see the hub's lang-kit preparation plan). Until then both copies stay, and any change to one copy's extracted fields is made in both."
acceptanceCriteria:
  - "One go.mod parser remains; rex and sourcevision both use it without a domain-to-domain import"
  - "rex analyze and sourcevision go-build tests pass unchanged"
  - "The six static root policy tests pass"
priority: "low"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "rex"
  - "follow-up"
  - "lang-kit"
---
