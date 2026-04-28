---
id: "1c0d65ba-447b-4285-a3bb-8ecaf18827fa"
level: "task"
title: "Address suggestion issues (11 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-02-28T05:09:26.029Z"
completedAt: "2026-02-28T05:20:51.730Z"
description: "- Audit test-implementation pairs to identify orphaned tests and incomplete features that may indicate architectural boundary violations\n- Consolidate scattered token usage functionality from polling-infrastructure and navigation-state-management into dedicated usage analytics zone\n- Contract definition inconsistency across service zones - only command-validation uses explicit contracts.ts pattern\n- Define architectural risk thresholds: zones with cohesion < 0.4 AND coupling > 0.6 should trigger mandatory refactoring\n- Implement architectural risk scoring to identify zones with both low cohesion (<0.3) and high coupling (>0.7) for priority refactoring\n- Prioritize refactoring zones with combined architectural risks: cohesion < 0.5 AND coupling > 0.6 indicate fragile components\n- Three zones show catastrophic fragility (coupling >0.65, cohesion <0.4) requiring immediate architectural intervention before further development\n- Decompose packages/web/src/viewer/views/prd.ts PRDView function (83 calls) into focused components: extract data fetching layer (estimated 20-25 calls), state management layer (estimated 15-20 calls), and presentation components (remaining calls)\n- Establish architectural governance thresholds: zones with cohesion <0.4 AND coupling >0.6 require mandatory refactoring before new feature development - currently affects web-8, web-10, web-12, web-16 requiring immediate intervention\n- Implement three-phase web package consolidation: Phase 1 - merge zones web-2,web-10,web-11,web-13 (shared coupling patterns), Phase 2 - consolidate visualization zones web-14,web-16,web-17,web-24, Phase 3 - extract shared UI foundation from primary web zone\n- Refactor web-16 zone to reduce 13+ imports from web zone by extracting shared interface layer or moving components to appropriate architectural tier"
recommendationMeta: "[object Object]"
---

## Subtask: Implement architectural risk scoring module in sourcevision

**ID:** `3c7748ef-5881-43f7-962b-e6b36c10ed6d`
**Status:** completed
**Priority:** critical

Consolidates 5 overlapping suggestions about architectural risk thresholds into a single risk scoring module. Add risk metrics to zones, classify zones into risk levels, and generate structured findings. Standardize on cohesion < 0.4 AND coupling > 0.6 as the governance threshold.

**Acceptance Criteria**

- New risk-scoring.ts analyzer module computes risk scores for all zones
- Zones get riskLevel classification: healthy | at-risk | critical | catastrophic
- Risk thresholds are configurable constants (cohesion < 0.4, coupling > 0.6)
- Zone schema type includes riskScore and riskLevel fields
- Risk findings are emitted for zones exceeding thresholds
- Unit tests cover risk scoring logic
- Build and typecheck pass

---

## Subtask: Consolidate token usage files into dedicated zone boundary

**ID:** `fb020bb9-525b-4b3c-a612-4a05ba1b29e7`
**Status:** completed
**Priority:** medium

Move scattered token usage functionality from polling-infrastructure (web-24) and navigation-state-management (web-26) zones into a coherent grouping. Address orphaned token-usage-nav.test.ts.

---

## Subtask: Refactor web-16 main.ts god component to reduce cross-zone coupling

**ID:** `fb8aa6a9-a6cd-48b3-b566-83405fb39907`
**Status:** completed
**Priority:** high

Extract view registry pattern from main.ts to eliminate 13+ direct imports from web zone. Separate bootstrap concerns from view orchestration. Addresses web-16 coupling (0.8) and cohesion (0.2).

---

## Subtask: Audit orphaned tests and standardize contract patterns

**ID:** `f087383f-f245-4a90-b174-0ba4d8fd5ccf`
**Status:** completed
**Priority:** low

Address two suggestions: audit test-implementation pairs for orphaned tests / incomplete features, and evaluate contract definition consistency across service zones.

---
