---
id: "1c0d65ba-447b-4285-a3bb-8ecaf18827fa"
level: "task"
title: "Address suggestion issues (11 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-02-28T05:09:26.029Z"
completedAt: "2026-02-28T05:20:51.730Z"
acceptanceCriteria: []
description: "- Audit test-implementation pairs to identify orphaned tests and incomplete features that may indicate architectural boundary violations\n- Consolidate scattered token usage functionality from polling-infrastructure and navigation-state-management into dedicated usage analytics zone\n- Contract definition inconsistency across service zones - only command-validation uses explicit contracts.ts pattern\n- Define architectural risk thresholds: zones with cohesion < 0.4 AND coupling > 0.6 should trigger mandatory refactoring\n- Implement architectural risk scoring to identify zones with both low cohesion (<0.3) and high coupling (>0.7) for priority refactoring\n- Prioritize refactoring zones with combined architectural risks: cohesion < 0.5 AND coupling > 0.6 indicate fragile components\n- Three zones show catastrophic fragility (coupling >0.65, cohesion <0.4) requiring immediate architectural intervention before further development\n- Decompose packages/web/src/viewer/views/prd.ts PRDView function (83 calls) into focused components: extract data fetching layer (estimated 20-25 calls), state management layer (estimated 15-20 calls), and presentation components (remaining calls)\n- Establish architectural governance thresholds: zones with cohesion <0.4 AND coupling >0.6 require mandatory refactoring before new feature development - currently affects web-8, web-10, web-12, web-16 requiring immediate intervention\n- Implement three-phase web package consolidation: Phase 1 - merge zones web-2,web-10,web-11,web-13 (shared coupling patterns), Phase 2 - consolidate visualization zones web-14,web-16,web-17,web-24, Phase 3 - extract shared UI foundation from primary web zone\n- Refactor web-16 zone to reduce 13+ imports from web zone by extracting shared interface layer or moving components to appropriate architectural tier"
recommendationMeta: "[object Object]"
---

# Address suggestion issues (11 findings)

🔴 [completed]

## Summary

- Audit test-implementation pairs to identify orphaned tests and incomplete features that may indicate architectural boundary violations
- Consolidate scattered token usage functionality from polling-infrastructure and navigation-state-management into dedicated usage analytics zone
- Contract definition inconsistency across service zones - only command-validation uses explicit contracts.ts pattern
- Define architectural risk thresholds: zones with cohesion < 0.4 AND coupling > 0.6 should trigger mandatory refactoring
- Implement architectural risk scoring to identify zones with both low cohesion (<0.3) and high coupling (>0.7) for priority refactoring
- Prioritize refactoring zones with combined architectural risks: cohesion < 0.5 AND coupling > 0.6 indicate fragile components
- Three zones show catastrophic fragility (coupling >0.65, cohesion <0.4) requiring immediate architectural intervention before further development
- Decompose packages/web/src/viewer/views/prd.ts PRDView function (83 calls) into focused components: extract data fetching layer (estimated 20-25 calls), state management layer (estimated 15-20 calls), and presentation components (remaining calls)
- Establish architectural governance thresholds: zones with cohesion <0.4 AND coupling >0.6 require mandatory refactoring before new feature development - currently affects web-8, web-10, web-12, web-16 requiring immediate intervention
- Implement three-phase web package consolidation: Phase 1 - merge zones web-2,web-10,web-11,web-13 (shared coupling patterns), Phase 2 - consolidate visualization zones web-14,web-16,web-17,web-24, Phase 3 - extract shared UI foundation from primary web zone
- Refactor web-16 zone to reduce 13+ imports from web zone by extracting shared interface layer or moving components to appropriate architectural tier

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-02-28T05:09:26.029Z
- **Completed:** 2026-02-28T05:20:51.730Z
- **Duration:** 11m
