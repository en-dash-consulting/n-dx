---
id: "510283d6-0316-4555-a175-582e4d7f3541"
level: "task"
title: "Address relationship issues (11 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-11T01:33:59.267Z"
completedAt: "2026-03-11T01:43:27.221Z"
resolutionType: "code-change"
resolutionDetail: "Addressed 11 relationship findings: extracted ViewId to shared layer, split cross-zone test imports, verified remaining findings as already resolved or non-actionable"
acceptanceCriteria: []
description: "- crash-recovery-system imports 3 symbols from web-viewer, creating a dependency on the layer it guards. If those imports are Preact hooks or component utilities, a renderer-level failure could silently break the recovery path. Prefer importing only framework-agnostic primitives (e.g., from web-shared) within crash recovery logic to keep the safety net independent of the failing layer.\n- With only 2 files guarding the cross-package contract surface while 33 web-viewer→web-server imports exist at runtime, the integration tier is significantly under-invested relative to the coupling it is supposed to guard — each heavy cross-zone edge should have a corresponding contract test here.\n- The landing page feature is structurally split: static assets (HTML/CSS) here, landing.ts in web-dashboard-peripheral-views. Consolidating landing.ts into this zone (or into a dedicated 'landing' directory) would give the marketing surface a single, self-contained home.\n- rex-prd-management-core imports 1 symbol from the web-server zone, creating an upward dependency from the Domain tier into the web composition root. Domain packages must not import from the web layer — the shared symbol should be relocated to the Foundation tier or a neutral shared module.\n- sourcevision-analysis-engine imports 1 symbol from the web-server zone — a Domain-tier package importing upward into the web composition root violates the four-tier hierarchy and the gateway-ownership rule that makes domain-gateway.ts the exclusive consumer of sourcevision APIs.\n- rex-unit → web-server (1 import) and sourcevision → web-server (1 import) both terminate in this zone; if either import targets an analytics service file rather than the gateway files, it bypasses the enforced gateway boundary. Auditing the exact import targets is warranted.\n- The single back-edge from web-viewer into viewer-route-state inverts the expected dependency direction: route state should be a pure input to the viewer, not a consumer of it. If the reverse import is a runtime value (not a type-only import), this constitutes a soft cycle that could cause initialization ordering issues in the Preact component tree.\n- web-server → web-viewer: 1 import closes the cycle with the 33-import reverse flow, producing a full bidirectional dependency between the two heaviest internal sub-zones. Even a single runtime import from server into viewer defeats the 'viewer is built separately and served as static assets' contract.\n- web-viewer → web-server: 33 imports violate the stated internal layering contract (CLAUDE.md: web-server is composition root, viewer must not import upward into server). If any of these are runtime imports they represent a critical layer inversion.\n- web-viewer ↔ web-unit bidirectional (7+1 imports) creates a secondary internal cycle; the single return import from web-viewer into web-unit should be traced to confirm it is a type-only import flowing through external.ts rather than a runtime dependency.\n- landing.ts is co-located in this zone (by import graph) while the static landing assets (HTML/CSS) form a separate landing-page-static-assets zone; the feature is split across two zones with no shared import backbone, making the landing surface harder to maintain."
recommendationMeta: "[object Object]"
---

# Address relationship issues (11 findings)

🔴 [completed]

## Summary

- crash-recovery-system imports 3 symbols from web-viewer, creating a dependency on the layer it guards. If those imports are Preact hooks or component utilities, a renderer-level failure could silently break the recovery path. Prefer importing only framework-agnostic primitives (e.g., from web-shared) within crash recovery logic to keep the safety net independent of the failing layer.
- With only 2 files guarding the cross-package contract surface while 33 web-viewer→web-server imports exist at runtime, the integration tier is significantly under-invested relative to the coupling it is supposed to guard — each heavy cross-zone edge should have a corresponding contract test here.
- The landing page feature is structurally split: static assets (HTML/CSS) here, landing.ts in web-dashboard-peripheral-views. Consolidating landing.ts into this zone (or into a dedicated 'landing' directory) would give the marketing surface a single, self-contained home.
- rex-prd-management-core imports 1 symbol from the web-server zone, creating an upward dependency from the Domain tier into the web composition root. Domain packages must not import from the web layer — the shared symbol should be relocated to the Foundation tier or a neutral shared module.
- sourcevision-analysis-engine imports 1 symbol from the web-server zone — a Domain-tier package importing upward into the web composition root violates the four-tier hierarchy and the gateway-ownership rule that makes domain-gateway.ts the exclusive consumer of sourcevision APIs.
- rex-unit → web-server (1 import) and sourcevision → web-server (1 import) both terminate in this zone; if either import targets an analytics service file rather than the gateway files, it bypasses the enforced gateway boundary. Auditing the exact import targets is warranted.
- The single back-edge from web-viewer into viewer-route-state inverts the expected dependency direction: route state should be a pure input to the viewer, not a consumer of it. If the reverse import is a runtime value (not a type-only import), this constitutes a soft cycle that could cause initialization ordering issues in the Preact component tree.
- web-server → web-viewer: 1 import closes the cycle with the 33-import reverse flow, producing a full bidirectional dependency between the two heaviest internal sub-zones. Even a single runtime import from server into viewer defeats the 'viewer is built separately and served as static assets' contract.
- web-viewer → web-server: 33 imports violate the stated internal layering contract (CLAUDE.md: web-server is composition root, viewer must not import upward into server). If any of these are runtime imports they represent a critical layer inversion.
- web-viewer ↔ web-unit bidirectional (7+1 imports) creates a secondary internal cycle; the single return import from web-viewer into web-unit should be traced to confirm it is a type-only import flowing through external.ts rather than a runtime dependency.
- landing.ts is co-located in this zone (by import graph) while the static landing assets (HTML/CSS) form a separate landing-page-static-assets zone; the feature is split across two zones with no shared import backbone, making the landing surface harder to maintain.

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-11T01:33:59.267Z
- **Completed:** 2026-03-11T01:43:27.221Z
- **Duration:** 9m
