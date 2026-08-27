---
id: "ebe4c082-7e93-44ee-a286-cf01c05dd907"
level: "epic"
title: "SourceVision"
status: "completed"
startedAt: "2026-04-13T18:35:49.604Z"
completedAt: "2026-03-24T04:16:45.798Z"
description: "Static analysis engine: file inventory, import graph, zone detection (Louvain community detection), React component catalog, PR markdown generation. Produces .sourcevision/CONTEXT.md and llms.txt for AI consumption.\n\n---\n\nBuild an evaluation harness in tests/gauntlet/ that captures sourcevision's current LLM-driven analysis output (zone enrichment, file classification) as golden fixtures and scores future runs against them. Once the harness exists, optimization PRs (Haiku swap, heuristic-first classifier, payload reduction, raised concurrency, skip-trivial-zones short-circuit, --full pass signature dedup, cached LLM replay, semantic zone-name scoring) become measured changes with eval-score deltas rather than vibes-based judgment. Motivation: sourcevision analyze burns substantial tokens and wall-clock time; multiple optimization paths exist but each carries silent quality regression risk."
---

## Children

| Title | Status |
|-------|--------|
| [Analysis Pipeline Optimization](./analysis-pipeline-optimization/index.md) | completed |
| [Analyze pipeline improvements](./analyze-pipeline-improvements/index.md) | completed |
| [Automatic PR Markdown Generation](./automatic-pr-markdown-generation/index.md) | completed |
| [Background Tab Resource Optimization](./background-tab-resource-optimization/index.md) | completed |
| [Fix 1: Go Zone Edge Resolution](./fix-1-go-zone-edge-resolution/index.md) | completed |
| [Fix 2: Mixed-Language Support](./fix-2-mixed-language-support/index.md) | completed |
| [Fix observation in sourcevision-2 (1 finding)](./fix-observation-in-sourcevision-3f7352/index.md) | completed |
| [Fix observation in sourcevision-cli (1 finding)](./fix-observation-in-sourcevision-6c79b3/index.md) | completed |
| [Fix suggestion in polling (1 finding)](./fix-suggestion-in-polling-1-finding/index.md) | completed |
| [Git Credential Helper Opt-In Recovery](./git-credential-helper-opt-in-recovery/index.md) | completed |
| [Git-Independent PR Markdown Generation](./git-independent-pr-markdown-generation/index.md) | completed |
| [Go Fixture Enhancement](./go-fixture-enhancement/index.md) | completed |
| [Go Import Parser](./go-import-parser/index.md) | completed |
| [Import Analyzer Language Dispatch](./import-analyzer-language-dispatch/index.md) | completed |
| [Landing page for n-dx](./landing-page-for-n-dx/index.md) | completed |
| [Live PR Markdown in SourceVision UI](./live-pr-markdown-in-sourcevision-ui/index.md) | completed |
| [ndx work Model Resolution, Display, and Vendor-Change Reset](./ndx-work-model-resolution-3d1dfc/index.md) | completed |
| [Phase 1: Language Registry & Inventory Foundation](./phase-1-language-registry-956b71/index.md) | completed |
| [PR Markdown Reviewer Context Enrichment](./pr-markdown-reviewer-context-enrichment/index.md) | completed |
| [PR Markdown View Toggle and Copy UX](./pr-markdown-view-toggle-and-copy-ux/index.md) | completed |
| [Recursive zone architecture](./recursive-zone-architecture/index.md) | completed |
| [Resolve critical SourceVision architectural findings](./resolve-critical-sourcevision-ecbbbb/index.md) | completed |
| [SourceVision Findings Remediation](./sourcevision-findings-remediation/index.md) | completed |
| [SourceVision Import Graph Visualization Enhancement](./sourcevision-import-graph-f5284d/index.md) | completed |
| [SourceVision PR Markdown Quality & Manual Refresh](./sourcevision-pr-markdown-1c8695/index.md) | completed |
| [SourceVision PR Markdown Artifact-Based Fallback Mode](./sourcevision-pr-markdown-5e3862/index.md) | completed |
| [SourceVision PR Markdown Refresh Degraded-Mode Hardening](./sourcevision-pr-markdown-ce5623/index.md) | completed |
| [SourceVision PR Markdown Git Preflight and Credential Diagnostics](./sourcevision-pr-markdown-git-f5e0f1/index.md) | completed |
| [SourceVision PR Markdown Tab Parity Hardening](./sourcevision-pr-markdown-tab-9d8ae9/index.md) | completed |
| [SourceVision Semantic Diff Failure UX Hardening](./sourcevision-semantic-diff-b52062/index.md) | completed |
| [SourceVision Token Efficiency and Prompt Compaction](./sourcevision-token-efficiency-ede8a6/index.md) | completed |
| [SourceVision UI Import Graph Enhancement](./sourcevision-ui-import-graph-enhancement/index.md) | completed |
| [Web Server Port Management](./web-server-port-management/index.md) | completed |
| [Web UI Memory Management and Crash Resolution](./web-ui-memory-management-and-0344ce/index.md) | completed |
| [Zone Detection Validation for Go Projects](./zone-detection-validation-for-fe5bf3/index.md) | completed |
