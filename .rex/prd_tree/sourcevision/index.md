---
id: "ebe4c082-7e93-44ee-a286-cf01c05dd907"
level: "epic"
title: "SourceVision"
status: "completed"
startedAt: "2026-04-13T18:35:49.604Z"
completedAt: "2026-03-24T04:16:45.798Z"
description: "Static analysis engine: file inventory, import graph, zone detection (Louvain community detection), React component catalog, PR markdown generation. Produces .sourcevision/CONTEXT.md and llms.txt for AI consumption.\n\n---\n\nBuild an evaluation harness in tests/gauntlet/ that captures sourcevision's current LLM-driven analysis output (zone enrichment, file classification) as golden fixtures and scores future runs against them. Once the harness exists, optimization PRs (Haiku swap, heuristic-first classifier, payload reduction, raised concurrency, skip-trivial-zones short-circuit, --full pass signature dedup, cached LLM replay, semantic zone-name scoring) become measured changes with eval-score deltas rather than vibes-based judgment. Motivation: sourcevision analyze burns substantial tokens and wall-clock time; multiple optimization paths exist but each carries silent quality regression risk."
---

# SourceVision

 [completed]

## Summary

Static analysis engine: file inventory, import graph, zone detection (Louvain community detection), React component catalog, PR markdown generation. Produces .sourcevision/CONTEXT.md and llms.txt for AI consumption.

---

Build an evaluation harness in tests/gauntlet/ that captures sourcevision's current LLM-driven analysis output (zone enrichment, file classification) as golden fixtures and scores future runs against them. Once the harness exists, optimization PRs (Haiku swap, heuristic-first classifier, payload reduction, raised concurrency, skip-trivial-zones short-circuit, --full pass signature dedup, cached LLM replay, semantic zone-name scoring) become measured changes with eval-score deltas rather than vibes-based judgment. Motivation: sourcevision analyze burns substantial tokens and wall-clock time; multiple optimization paths exist but each carries silent quality regression risk.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Analysis Pipeline Optimization | feature | completed | 2026-02-09 |
| Analyze pipeline improvements | feature | completed | 2026-02-24 |
| Automatic PR Markdown Generation | feature | completed | 2026-02-25 |
| Background Tab Resource Optimization | feature | completed | 2026-02-27 |
| Fix 1: Go Zone Edge Resolution | feature | completed | 2026-03-26 |
| Fix 2: Mixed-Language Support | feature | completed | 2026-03-26 |
| Fix observation in sourcevision-cli (1 finding) | feature | completed | 2026-04-13 |
| Fix observation in sourcevision-2 (1 finding) | feature | completed | 2026-04-13 |
| Fix suggestion in polling (1 finding) | feature | completed | 2026-04-13 |
| Git Credential Helper Opt-In Recovery | feature | completed | 2026-02-23 |
| Git-Independent PR Markdown Generation | feature | completed | 2026-02-23 |
| Go Fixture Enhancement | feature | completed | 2026-03-26 |
| Go Import Parser | feature | completed | 2026-03-26 |
| Import Analyzer Language Dispatch | feature | completed | 2026-03-26 |
| Landing page for n-dx | feature | completed | 2026-02-13 |
| Live PR Markdown in SourceVision UI | feature | completed | 2026-02-21 |
| ndx work Model Resolution, Display, and Vendor-Change Reset | feature | completed | 2026-04-14 |
| Phase 1: Language Registry & Inventory Foundation | feature | completed | 2026-03-26 |
| PR Markdown Reviewer Context Enrichment | feature | completed | 2026-02-22 |
| PR Markdown View Toggle and Copy UX | feature | completed | 2026-02-23 |
| Recursive zone architecture | feature | completed | 2026-03-02 |
| Resolve critical SourceVision architectural findings | feature | completed | 2026-02-11 |
| SourceVision Findings Remediation | feature | completed | 2026-03-06 |
| SourceVision Import Graph Visualization Enhancement | feature | completed | 2026-02-11 |
| SourceVision PR Markdown Quality & Manual Refresh | feature | completed | 2026-02-21 |
| SourceVision PR Markdown Artifact-Based Fallback Mode | feature | completed | 2026-02-23 |
| SourceVision PR Markdown Refresh Degraded-Mode Hardening | feature | completed | 2026-02-22 |
| SourceVision PR Markdown Git Preflight and Credential Diagnostics | feature | completed | 2026-02-23 |
| SourceVision PR Markdown Tab Parity Hardening | feature | completed | 2026-02-21 |
| SourceVision Semantic Diff Failure UX Hardening | feature | completed | 2026-02-23 |
| SourceVision Token Efficiency and Prompt Compaction | feature | completed | 2026-04-14 |
| SourceVision UI Import Graph Enhancement | feature | completed | 2026-02-18 |
| Web Server Port Management | feature | completed | 2026-02-18 |
| Web UI Memory Management and Crash Resolution | feature | completed | 2026-02-24 |
| Zone Detection Validation for Go Projects | feature | completed | 2026-03-26 |

## Info

- **Status:** completed
- **Level:** epic
- **Started:** 2026-04-13T18:35:49.604Z
- **Completed:** 2026-03-24T04:16:45.798Z
