---
id: "f9b53844-b7a5-4dde-89f3-9cd5e38e2d22"
level: "task"
title: "Keep imports of Go files over the pack's size cap and of replaced modules in skipped directories"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "lang-go"
  - "sourcevision"
  - "pr-18"
source: "review"
startedAt: "2026-10-17T07:16:44.874Z"
completedAt: "2026-10-17T07:23:07.664Z"
endedAt: "2026-10-17T07:23:07.664Z"
resolutionType: "code-change"
resolutionDetail: "Go files the pack leaves unparsed (over 1 MB) go to the regex parser; the Go resolver records an import of a directory with no inventoried .go files as external, attributed to its require."
acceptanceCriteria:
  - "A Go file over the pack's size cap keeps its import edges via the regex fallback"
  - "An import resolved to a directory with no inventoried .go files is recorded as external"
  - "Fixtures cover both; changeset mentions the size-cap fallback"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block ~/.cache corpora; leave corpus checks to the session and do not capture follow-ups for them."}
description: "Stack review (#766), two Go findings.\n\n1. **Go files over 1 MB lose all their imports** (pack-imports.ts around line 185). The runner skips files over DEFAULT_MAX_FILE_BYTES, so a large Go file gets no captures and resolve() never runs for it. Its outgoing edges, and its entries in other packages' importedBy, disappear. The regex parser this replaced read every file at any size, and large Go files are common: k8s zz_generated.openapi.go, big .pb.go files, bindata. Fix: run extractGoImports on the Go files the pack reports as unparsed, a fallback that already exists in analyzeImports, so their imports resolve as before. Neither the resolver header nor the changeset mentions this today; say it in the changeset.\n\n2. **A Go import that resolves to a project directory with no inventoried .go files is dropped entirely, external entry included** (lang-go go-resolver.ts around line 319). Take `require github.com/foo/bar v1.2.3` plus `replace github.com/foo/bar => ./third_party/bar`: the inventory skips third_party/ (also build/, dist/ and gitignored targets). The local replace maps the module to that directory, index.packages has no members there, and `continue` produces neither an edge nor an external. The regex parser reported it as external. Fix: when the resolved directory has no members, call out.externalPackage(imp.path, module) instead of continue.\n\nTests: a fixture with a Go file over the cap (or a lowered cap in the test) whose imports resolve, and a fixture with the third_party replace pattern recorded as external. Go corpus repos (microservices-demo) should stay identical unless they contain such files; the session checks."
lastModified: "2026-10-17T07:23:07.984Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
