---
id: "001478c3-fa5a-45eb-bd4c-6b3161abccd2"
level: "feature"
title: "Move the Jev client into llm-client and redact Bitbucket tokens"
status: "pending"
priority: "medium"
tags:
  - "product-map"
  - "pr-04"
  - "lane-models-analysis"
  - "llm-client"
  - "sourcevision"
source: "roadmap"
acceptanceCriteria: []
description: "rex needs Jev for placement but cannot import sourcevision (domain isolation), so the Jev client and judgment cache move down to @n-dx/llm-client. The same lane adds Bitbucket credentials to redaction for host neutrality.\n\nRoadmap PR 4 · wave 0 · lane models-analysis."
lastModified: "2026-10-06T04:16:43.326Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Bitbucket token patterns in redact.ts are tested only against samples built from the patterns themselves](./bitbucket-token-patterns-in-redact-ts.md) | pending |
| [Make the llm-client seam registry readable by every assistant, not only Claude](./make-the-llm-client-seam-registry.md) | completed |
| [Move the Jev client and judgment cache from sourcevision into llm-client](./move-the-jev-client-and-judgment-cache.md) | completed |
| [Redact Bitbucket app passwords and access tokens](./redact-bitbucket-app-passwords-and.md) | completed |
