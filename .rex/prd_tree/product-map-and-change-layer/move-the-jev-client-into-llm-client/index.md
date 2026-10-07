---
id: "001478c3-fa5a-45eb-bd4c-6b3161abccd2"
level: "feature"
title: "Move the Jev client into llm-client and redact Bitbucket tokens"
status: "completed"
priority: "medium"
tags:
  - "product-map"
  - "pr-04"
  - "lane-models-analysis"
  - "llm-client"
  - "sourcevision"
source: "roadmap"
startedAt: "2026-10-06T22:54:50.987Z"
completedAt: "2026-10-06T22:54:50.987Z"
endedAt: "2026-10-06T22:54:50.987Z"
acceptanceCriteria: []
description: "rex needs Jev for placement but cannot import sourcevision (domain isolation), so the Jev client and judgment cache move down to @n-dx/llm-client. The same lane adds Bitbucket credentials to redaction for host neutrality.\n\nRoadmap PR 4 · wave 0 · lane models-analysis."
lastModified: "2026-10-06T22:54:51.439Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Make the llm-client seam registry readable by every assistant, not only Claude](./make-the-llm-client-seam-registry.md) | completed |
| [Move the Jev client and judgment cache from sourcevision into llm-client](./move-the-jev-client-and-judgment-cache.md) | completed |
| [Redact Bitbucket app passwords and access tokens](./redact-bitbucket-app-passwords-and.md) | completed |
