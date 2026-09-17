---
id: "3d1dfc17-ba48-4fb7-8b2e-392593740605"
level: "feature"
title: "ndx work Model Resolution, Display, and Vendor-Change Reset"
status: "completed"
priority: "high"
source: "smart-add"
startedAt: "2026-04-14T16:33:04.573Z"
completedAt: "2026-04-14T16:33:04.573Z"
acceptanceCriteria: []
description: "The ndx work command does not surface the LLM model configured in .n-dx.json to the user at run time, and may not propagate it to the underlying hench LLM call sites. Additionally, when the vendor is changed, a stale model value from the previous vendor can persist in config, causing silent misconfiguration."
recommendationMeta: "[object Object]"
---

## Children

| Title | Status |
|-------|--------|
| [Fix observation in global: Bidirectional coupling: "web" ↔ "web-server" (85+5 crossings) — consider extract](./fix-observation-in-global-de5ca6.md) | completed |
| [Implement vendor-change model reset to prevent cross-vendor stale config](./implement-vendor-change-model-cc8616.md) | completed |
