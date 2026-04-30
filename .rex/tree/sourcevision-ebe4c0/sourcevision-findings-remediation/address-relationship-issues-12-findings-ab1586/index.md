---
id: "ab158626-5487-4370-936e-d00e0ff5425b"
level: "task"
title: "Address relationship issues (12 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-11T15:24:57.198Z"
completedAt: "2026-03-11T15:40:48.679Z"
resolutionType: "code-change"
resolutionDetail: "Addressed 12 relationship findings: pinned 33 misclassified server files to web-server zone (fixing pre-existing layering test failure), added exhaustive server→viewer allowlist assertion, added hooks coupling guard, created rex domain-layer boundary integration test, and updated cohesion gate exceptions"
acceptanceCriteria: []
description: "- rex-prd-engine imports from chunked-review (2 crossings), meaning the CLI satellite zone is not a pure leaf node — it introduces a load-order dependency from the domain layer onto a CLI command handler, which can cause initialization failures in bundled or ESM contexts.\n- hench-guard ↔ hench-agent is the only bidirectional cycle outside the web package — it is also the only cycle where the smaller zone (10 files) imports into the larger (141 files) rather than the reverse, confirming this is a policy-layer inversion rather than organic coupling growth.\n- Integration test zone has no test targeting the rex-core ↔ rex-unit bidirectional import cycle — the only structural cycle flagged as critical in the codebase has no dedicated regression test at the integration layer.\n- web-server-viewer-boundary test should assert an exhaustive allowlist of permitted web-server→web-viewer imports (currently 3), not just the absence of a known bad import — without an allowlist, new reverse imports silently pass.\n- core/fix.ts sits outside cli/ but inside the prd-fix-command zone boundary and likely supplies the 1 return import that rex-prd-engine emits back — if core/fix.ts has only one consumer (fix.ts), it should be absorbed into the command handler, which would also sever the return edge and eliminate the cycle.\n- The 3 outbound imports from rex-core-utilities into rex-prd-engine (likely schema/type imports) combined with 8 inbound imports from the engine create a type-dependency loop — verify.ts or keywords.ts depend on types defined in the very zone that consumes them, which is structurally identical to a circular import even if the build currently resolves it.\n- batch-types.ts is physically located in packages/rex/src/analyze/ (within the rex-prd-engine directory tree) but is classified under the chunked-review zone — this file-location/zone-membership mismatch is a leaky abstraction: callers of the analyze/ directory implicitly cross a zone boundary without any import path signal.\n- rex-prd-engine imports back into chunked-review (rex-unit → rex-cli: 2 imports) — the main domain layer has an upward dependency on a CLI satellite zone, inverting the expected CLI-over-domain layering and creating a critical architecture violation.\n- server-usage-scheduler imports from web-viewer (3 imports) despite web-viewer being a higher-layer UI hub — server-side services must not depend on viewer code; these imports likely pull in types that should live in web-shared or a dedicated server-types module\n- use-toast and use-feature-toggle have zero external imports and are general-purpose hooks that could be consumed by any viewer zone. Currently there is no boundary-check assertion requiring consumers to access them through a barrel. As the hook count grows, add a barrel enforcement assertion analogous to the crash/ sub-zone check to prevent silent coupling growth.\n- web-dashboard-platform → web-viewer (7 imports) combined with web-viewer → web-dashboard-platform (23 imports) forms a runtime circular dependency in the Preact bundle; Preact/Vite cannot resolve initialization order across circular imports, making this a potential runtime crash vector\n- web-viewer participates in four simultaneous bidirectional coupling pairs (web-server ×39+3, web-dashboard-platform ×23+7, use ×12+1, crash ×2+2) — no other zone has more than one bidirectional pair, making web-viewer a unique structural liability"
recommendationMeta: "[object Object]"
---

# Address relationship issues (12 findings)

🔴 [completed]

## Summary

- rex-prd-engine imports from chunked-review (2 crossings), meaning the CLI satellite zone is not a pure leaf node — it introduces a load-order dependency from the domain layer onto a CLI command handler, which can cause initialization failures in bundled or ESM contexts.
- hench-guard ↔ hench-agent is the only bidirectional cycle outside the web package — it is also the only cycle where the smaller zone (10 files) imports into the larger (141 files) rather than the reverse, confirming this is a policy-layer inversion rather than organic coupling growth.
- Integration test zone has no test targeting the rex-core ↔ rex-unit bidirectional import cycle — the only structural cycle flagged as critical in the codebase has no dedicated regression test at the integration layer.
- web-server-viewer-boundary test should assert an exhaustive allowlist of permitted web-server→web-viewer imports (currently 3), not just the absence of a known bad import — without an allowlist, new reverse imports silently pass.
- core/fix.ts sits outside cli/ but inside the prd-fix-command zone boundary and likely supplies the 1 return import that rex-prd-engine emits back — if core/fix.ts has only one consumer (fix.ts), it should be absorbed into the command handler, which would also sever the return edge and eliminate the cycle.
- The 3 outbound imports from rex-core-utilities into rex-prd-engine (likely schema/type imports) combined with 8 inbound imports from the engine create a type-dependency loop — verify.ts or keywords.ts depend on types defined in the very zone that consumes them, which is structurally identical to a circular import even if the build currently resolves it.
- batch-types.ts is physically located in packages/rex/src/analyze/ (within the rex-prd-engine directory tree) but is classified under the chunked-review zone — this file-location/zone-membership mismatch is a leaky abstraction: callers of the analyze/ directory implicitly cross a zone boundary without any import path signal.
- rex-prd-engine imports back into chunked-review (rex-unit → rex-cli: 2 imports) — the main domain layer has an upward dependency on a CLI satellite zone, inverting the expected CLI-over-domain layering and creating a critical architecture violation.
- server-usage-scheduler imports from web-viewer (3 imports) despite web-viewer being a higher-layer UI hub — server-side services must not depend on viewer code; these imports likely pull in types that should live in web-shared or a dedicated server-types module
- use-toast and use-feature-toggle have zero external imports and are general-purpose hooks that could be consumed by any viewer zone. Currently there is no boundary-check assertion requiring consumers to access them through a barrel. As the hook count grows, add a barrel enforcement assertion analogous to the crash/ sub-zone check to prevent silent coupling growth.
- web-dashboard-platform → web-viewer (7 imports) combined with web-viewer → web-dashboard-platform (23 imports) forms a runtime circular dependency in the Preact bundle; Preact/Vite cannot resolve initialization order across circular imports, making this a potential runtime crash vector
- web-viewer participates in four simultaneous bidirectional coupling pairs (web-server ×39+3, web-dashboard-platform ×23+7, use ×12+1, crash ×2+2) — no other zone has more than one bidirectional pair, making web-viewer a unique structural liability

## Info

- **Status:** completed
- **Priority:** critical
- **Level:** task
- **Started:** 2026-03-11T15:24:57.198Z
- **Completed:** 2026-03-11T15:40:48.679Z
- **Duration:** 15m
