---
id: "ebe4c082-7e93-44ee-a286-cf01c05dd907"
type: "area"
title: "SourceVision"
slug: "sourcevision"
summary: "Static analysis engine: file inventory, import graph, zone detection (Louvain community detection), React component catalog, PR markdown generation. Produces .sourcevision/CONTEXT.md and llms.txt for AI consumption.\n\n---\n\nBuild an evaluation harness in tests/gauntlet/ that captures sourcevision's current LLM-driven analysis output (zone enrichment, file classification) as golden fixtures and scores future runs against them. Once the harness exists, optimization PRs (Haiku swap, heuristic-first classifier, payload reduction, raised concurrency, skip-trivial-zones short-circuit, --full pass signature dedup, cached LLM replay, semantic zone-name scoring) become measured changes with eval-score deltas rather than vibes-based judgment. Motivation: sourcevision analyze burns substantial tokens and wall-clock time; multiple optimization paths exist but each carries silent quality regression risk."
---
