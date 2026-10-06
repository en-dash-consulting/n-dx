---
id: "e6649d84-5c5d-4e48-8a83-7ea8a37dc110"
level: "task"
title: "Build the readiness scorecard with weights in one exported constant"
status: "pending"
priority: "high"
blockedBy:
  - "19910eb0-3773-48ef-8243-dc790402ce5e"
source: "ndx-capture"
acceptanceCriteria:
  - "`analyzers/readiness-score.ts` exports `ReadinessScore { overall, dimensions: Record<name, { score, weight, evidence[], gaps[] }>, suggestions[] }` matching the weighted shape of `packages/rex/src/core/health.ts`."
  - "The nine dimension weights live in a single exported constant and are referenced from there everywhere — including by tests and by the docs generation — with no literal duplicates."
  - "`overall` is the weighted sum of the dimension scores and the weights sum to 1.0, asserted by a test."
  - "Every dimension's `evidence[]` is drawn from the profile's detections rather than recomputed, and a dimension with no evidence scores zero with a gap explaining why."
  - "Each gap states what evidence would raise the score."
  - "`suggestions[]` are aimed at the weakest dimension, as rex health does."
  - "The `agentSafety` dimension reads `packages/llm-client/src/repo-trust.ts` findings; that file is unchanged."
  - "Fixtures exist for a Node repo with GitHub Actions deploying via Helm with Prisma migrations and LaunchDarkly, a Go repo with GitLab CI and no tests, and an empty repo."
  - "Unit tests assert the exact overall and per-dimension scores for all three fixtures."
description: "`analyzers/readiness-score.ts` turns the detected profile into a score. Copy the shape of `packages/rex/src/core/health.ts` — weighted dimensions scored 0-100, overall as the weighted sum, suggestions aimed at the weakest dimension — so the dashboard can render PRD health and repo readiness identically.\n\n`ReadinessScore { overall, dimensions: Record<name, { score, weight, evidence[], gaps[] }>, suggestions[] }`.\n\nStarting weights: testing 0.20, ci 0.15, cd 0.15, rollback 0.10, migrations 0.10, featureFlags 0.05, qualityGates 0.10, observability 0.05, agentSafety 0.10. They live in **one** exported constant — not inlined at the call sites, not mirrored in tests, not restated in the docs table as literals.\n\n`agentSafety` is fed by `packages/llm-client/src/repo-trust.ts` findings, referenced in place; that module is not moved or modified.\n\nThe scorecard is heuristic and the gaps are the useful output: each one must say what evidence would raise the score, so it is actionable rather than a complaint. Fixtures assert exact scores precisely so that any later weight change has to be made on purpose."
lastModified: "2026-10-05T17:38:05.810Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
