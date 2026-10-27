---
id: "a40abbfe-7834-4adc-885b-70e7d80092e1"
type: "change"
title: "Fix 2: Mixed-Language Support"
slug: "fix-2-mixed-language-support"
intent: "Projects containing both Go and TypeScript files (e.g., a Go CLI with a Next.js docs site) detect only a single primary language. The non-primary language's files are inventoried but produce sparse import edges and orphan zones with 0 cohesion because `manifest.language` is a single string, archetype signal filtering scopes to one language, and only the primary language's skip directories, config file names, and test patterns are applied. Applying Fix 1 (zone edge resolution) first is recommended, but this fix is independent — together they make mixed Go+TS projects produce fully meaningful analysis."
source: "smart-add"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "Import Analyzer Language Dispatch" (aac0a41c-0157-4cca-a75d-efd7655ba909).
