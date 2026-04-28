---
id: "d4148da9-5f03-4853-90c8-fd19cc2da658"
level: "task"
title: "Address pattern issues (9 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-02-28T04:54:32.129Z"
completedAt: "2026-02-28T05:09:25.735Z"
description: "- Client-server architectural boundary is well-maintained except for schema-infrastructure zone violation\n- Cross-cutting performance concerns are integrated into functional zones rather than separated into performance layers\n- Domain boundary success varies dramatically: hench achieves clean layered isolation while web shows architectural sprawl across 29 zones\n- Foundation anti-pattern where ui-foundation contains both infrastructure utilities and application-specific views\n- Inconsistent service abstraction patterns across utility zones - some achieve clean boundaries while others leak implementation details to consumers\n- Inconsistent use of abstraction patterns (hooks vs direct coupling) across similar UI zones indicates need for architectural standardization\n- Zone size distribution shows healthy specialization pattern broken by one oversized catch-all zone that needs decomposition\n- Critical architectural debt concentration in web package: 29 fragmented zones + god-zone pattern + systematic high coupling (12+ zones >0.6) indicates architectural reset needed before incremental improvements\n- Missing abstraction layer pattern spans visualization (charts + navigation), UI foundation (scattered across zones), and service interfaces (inconsistent contract patterns), indicating systematic under-architecture rather than over-engineering"
recommendationMeta: "[object Object]"
---

## Subtask: Extract viewer infrastructure into organized subdirectories

**ID:** `821546fe-342f-4f03-b670-05695295ca34`
**Status:** completed
**Priority:** critical

Move 19 root-level infrastructure files from viewer/ into logical subdirectories: viewer/performance/ (DOM optimization, memory, crash, degradation, gates), viewer/polling/ (state, manager, restart, visibility, tick, refresh), viewer/messaging/ (coalescer, throttle, rate limiter, dedup). Update all import paths. Add barrel exports. Addresses findings: cross-cutting performance concerns, oversized catch-all zone, god-zone pattern, missing abstraction layers.

**Acceptance Criteria**

- No infrastructure files remain at viewer/ root (only main.ts, types.ts, utils.ts, route-state.ts, sourcevision-tabs.ts, schema-compat.ts, loader.ts)
- Files organized into viewer/performance/, viewer/polling/, viewer/messaging/
- All import paths updated and build passes
- Tests pass with no regressions

---

## Subtask: Fix foundation zone boundaries and standardize abstraction patterns

**ID:** `c6599984-d5d9-4ad1-8c6f-81d201213c71`
**Status:** completed
**Priority:** high

Address ui-foundation anti-pattern (web-7): domain-specific views mixed with infrastructure primitives. Standardize hook vs direct coupling patterns across UI zones. Addresses findings: foundation anti-pattern, inconsistent service abstraction patterns, inconsistent hook patterns.

**Acceptance Criteria**

- Foundation layer contains only infrastructure primitives, not domain views
- Consistent hook abstraction pattern across all infrastructure services
- Build and tests pass

---

## Subtask: Fix schema-infrastructure client-server boundary violation

**ID:** `b527dfb0-19f5-4d86-b56f-96218c38e04c`
**Status:** completed
**Priority:** high

Clean separation between schema/ validation (server-side contracts) and viewer/ data loading (client-side). Address the zone violation where schema files are grouped with viewer files. Addresses findings: client-server boundary violation, domain boundary sprawl.

**Acceptance Criteria**

- Schema validation imports do not cross into viewer data-loading layer
- Clean import boundaries between schema/ and viewer/
- Build and tests pass

---
