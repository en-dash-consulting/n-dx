---
id: "9b692c8a-208f-4676-952e-1674631a3a4c"
level: "task"
title: "Consolidate the duplicate go.mod parser (rex parseGoMod and sourcevision go-build)"
status: "pending"
priority: "low"
tags:
  - "language-packs"
  - "go"
  - "sourcevision"
  - "rex"
  - "follow-up"
description: "rex/src/analyze/scanners.ts parseGoMod and sourcevision/src/language/go-build.ts parseGoMod both parse go.mod. Domain packages may not import each other, so the parser is duplicated. Consolidate into one implementation and delete one copy. Needs a decision on where shared parsing belongs."
lastModified: "2026-10-08T06:20:13.985Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
