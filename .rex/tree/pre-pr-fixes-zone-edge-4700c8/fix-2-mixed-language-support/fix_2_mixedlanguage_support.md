---
id: "a40abbfe-7834-4adc-885b-70e7d80092e1"
level: "feature"
title: "Fix 2: Mixed-Language Support"
status: "completed"
source: "smart-add"
startedAt: "2026-03-26T21:19:10.766Z"
completedAt: "2026-03-26T21:19:10.766Z"
acceptanceCriteria: []
description: "Projects containing both Go and TypeScript files (e.g., a Go CLI with a Next.js docs site) detect only a single primary language. The non-primary language's files are inventoried but produce sparse import edges and orphan zones with 0 cohesion because `manifest.language` is a single string, archetype signal filtering scopes to one language, and only the primary language's skip directories, config file names, and test patterns are applied. Applying Fix 1 (zone edge resolution) first is recommended, but this fix is independent — together they make mixed Go+TS projects produce fully meaningful analysis."
---

## Children

| Title | Status |
|-------|--------|
| [Add test coverage for mixed-language detection](./add-test-coverage-for-mixed-44a1fc/index.md) | completed |
| [Implement multi-language detection and extend Manifest schema](./implement-multi-language-d56717/index.md) | completed |
