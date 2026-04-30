---
id: "4f87bb38-11d7-48e9-a143-d9efa9f251ab"
level: "epic"
title: "Sourcevision LLM eval harness & token reduction"
status: "completed"
priority: "high"
startedAt: "2026-04-28T15:11:46.163Z"
completedAt: "2026-04-28T15:11:46.163Z"
endedAt: "2026-04-28T15:11:46.163Z"
description: "Build an evaluation harness in tests/gauntlet/ that captures sourcevision's current LLM-driven analysis output (zone enrichment, file classification) as golden fixtures and scores future runs against them. Once the harness exists, optimization PRs (Haiku swap, heuristic-first classifier, payload reduction, raised concurrency, skip-trivial-zones short-circuit, --full pass signature dedup, cached LLM replay, semantic zone-name scoring) become measured changes with eval-score deltas rather than vibes-based judgment. Motivation: sourcevision analyze burns substantial tokens and wall-clock time; multiple optimization paths exist but each carries silent quality regression risk."
---

# Sourcevision LLM eval harness & token reduction

🟠 [completed]

## Summary

Build an evaluation harness in tests/gauntlet/ that captures sourcevision's current LLM-driven analysis output (zone enrichment, file classification) as golden fixtures and scores future runs against them. Once the harness exists, optimization PRs (Haiku swap, heuristic-first classifier, payload reduction, raised concurrency, skip-trivial-zones short-circuit, --full pass signature dedup, cached LLM replay, semantic zone-name scoring) become measured changes with eval-score deltas rather than vibes-based judgment. Motivation: sourcevision analyze burns substantial tokens and wall-clock time; multiple optimization paths exist but each carries silent quality regression risk.

## Info

- **Status:** completed
- **Priority:** high
- **Level:** epic
- **Started:** 2026-04-28T15:11:46.163Z
- **Completed:** 2026-04-28T15:11:46.163Z
- **Duration:** < 1m
