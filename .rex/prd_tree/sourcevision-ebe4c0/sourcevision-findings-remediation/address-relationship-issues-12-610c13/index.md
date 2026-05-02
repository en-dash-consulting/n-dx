---
id: "610c13c5-fe20-4049-bade-028ee4f18816"
level: "task"
title: "Address relationship issues (12 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-11T05:42:43.994Z"
completedAt: "2026-03-11T05:52:15.814Z"
resolutionType: "code-change"
resolutionDetail: "Fixed sourcevision serve.ts tier inversion, added zone pins for misclassified files, updated cohesion exceptions, and added cross-package path enforcement test"
acceptanceCriteria: []
description: "- crash ↔ web-viewer (2+2 symmetric cycle): equal edge counts in both directions are a strong signal of an unextracted shared interface. Define a crash-boundary type module in crash/ or web-shared to break the cycle.\n- data-routes imports 7 symbols from web-viewer. Route handlers should produce data consumed by the viewer, not depend on viewer-internal types. Verify all 7 imports flow through viewer/api.ts; any that reach into viewer-internal modules represent a layering inversion between the server route and UI layers.\n- rex-core exports to rex-fix-command (7 imports) while also importing from it (1 import), creating a bidirectional dependency where the canonical core depends on a satellite command — the reverse edge must be removed to restore layering\n- High coupling (0.75) is entirely attributable to 7 imports from fix into rex-core, which is correct; the 1 reverse import from rex-core into fix is the sole violation and the only edge that needs removal\n- sourcevision-engine has 1 outbound import into web-server, which is a tier-inversion: Domain importing from Web Execution violates the four-tier hierarchy and compromises package independence\n- usage-tracking-scheduler has 1 outbound import into web-viewer. Server-side scheduling code importing from the viewer layer (which is compiled separately and served as static assets) is a build-boundary violation if the import is runtime rather than type-only. Trace and confirm it is an `import type` or relocate the shared symbol to web-shared or web-server.\n- web-landing (HTML/CSS) and landing.ts (web-peripheral) form an implicit subsystem split across two zones with zero shared import edges. Because HTML and CSS are invisible to the import graph, this split is undetectable by all graph-based tooling and must be resolved by physical co-location.\n- web-peripheral imports directly from web-server (2 edges), bypassing the web-viewer hub. CLAUDE.md documents hub-and-spoke with web-viewer at center; a direct peripheral→server edge is architecturally undocumented and adds a hidden composition-root dependency to an already heterogeneous zone.\n- web-viewer has 1 import into web-unit (a test zone). Production code depending on test infrastructure is a critical boundary violation — the dependency must be inverted or the shared symbol relocated to a production module.\n- web-viewer imports from web-unit (1 edge), meaning production hub code depends on test infrastructure — this edge should be eliminated or the shared symbol moved to a production module\n- web-viewer imports from web-unit (1 edge): production code must never import from a test zone. Trace the import and relocate the shared symbol to a production module or web-shared.\n- web-viewer → web-unit (1 import) inverts the production/test dependency direction: production hub code imports from a test-only zone. This is the sole instance in the codebase where production source depends on test infrastructure and must be eliminated — move any shared type or utility needed by both into web-shared or a dedicated types file inside web-viewer."
recommendationMeta: "[object Object]"
---

# Address relationship issues (12 findings)

🔴 [completed]

## Summary

- crash ↔ web-viewer (2+2 symmetric cycle): equal edge counts in both directions are a strong signal of an unextracted shared interface. Define a crash-boundary type module in crash/ or web-shared to break the cycle.
- data-routes imports 7 symbols from web-viewer. Route handlers should produce data consumed by the viewer, not depend on viewer-internal types. Verify all 7 imports flow through viewer/api.ts; any that reach into viewer-internal modules represent a layering inversion between the server route and UI layers.
- rex-core exports to rex-fix-command (7 imports) while also importing from it (1 import), creating a bidirectional dependency where the canonical core depends on a satellite command — the reverse edge must be removed to restore layering
- High coupling (0.75) is entirely attributable to 7 imports from fix into rex-core, which is correct; the 1 reverse import from rex-core into fix is the sole violation and the only edge that needs removal
- sourcevision-engine has 1 outbound import into web-server, which is a tier-inversion: Domain importing from Web Execution violates the four-tier hierarchy and compromises package independence
- usage-tracking-scheduler has 1 outbound import into web-viewer. Server-side scheduling code importing from the viewer layer (which is compiled separately and served as static assets) is a build-boundary violation if the import is runtime rather than type-only. Trace and confirm it is an `import type` or relocate the shared symbol to web-shared or web-server.
- web-landing (HTML/CSS) and landing.ts (web-peripheral) form an implicit subsystem split across two zones with zero shared import edges. Because HTML and CSS are invisible to the import graph, this split is undetectable by all graph-based tooling and must be resolved by physical co-location.
- web-peripheral imports directly from web-server (2 edges), bypassing the web-viewer hub. CLAUDE.md documents hub-and-spoke with web-viewer at center; a direct peripheral→server edge is architecturally undocumented and adds a hidden composition-root dependency to an already heterogeneous zone.
- web-viewer has 1 import into web-unit (a test zone). Production code depending on test infrastructure is a critical boundary violation — the dependency must be inverted or the shared symbol relocated to a production module.
- web-viewer imports from web-unit (1 edge), meaning production hub code depends on test infrastructure — this edge should be eliminated or the shared symbol moved to a production module
- web-viewer imports from web-unit (1 edge): production code must never import from a test zone. Trace the import and relocate the shared symbol to a production module or web-shared.
- web-viewer → web-unit (1 import) inverts the production/test dependency direction: production hub code imports from a test-only zone. This is the sole instance in the codebase where production source depends on test infrastructure and must be eliminated — move any shared type or utility needed by both into web-shared or a dedicated types file inside web-viewer.

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-11T05:42:43.994Z
- **Completed:** 2026-03-11T05:52:15.814Z
- **Duration:** 9m
