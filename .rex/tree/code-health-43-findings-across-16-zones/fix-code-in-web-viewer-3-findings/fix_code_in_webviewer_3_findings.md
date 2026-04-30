---
id: "4a8cfe94-39a7-4c24-b10a-28376a222cd4"
level: "feature"
title: "Fix code in web-viewer (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-04-14T01:44:30.962Z"
completedAt: "2026-04-14T01:44:30.962Z"
acceptanceCriteria: []
description: "- boundary-check.test.ts does not assert that viewer→server imports are type-only. Since the viewer and server are separate build artifacts, any runtime import in this direction would be a build-time boundary violation. Although the current codebase has zero real server imports in viewer code, the absence of an automated assertion means a future contributor can introduce one silently — the test that enforces the web-shared addition policy is the natural place to add this guard.\n- external.ts imports from shared/ leaf files (features.js, data-files.js, view-id.js) rather than through shared/index.ts, bypassing the barrel rule it enforces for every other consumer. The exemption in boundary-check.test.ts (line 326) is necessary for the test to pass but makes external.ts a misleading reference implementation. Change the three leaf-file imports in external.ts to import through ../shared/index.ts to make the reference implementation self-consistent.\n- viewer/external.ts bypasses the web-shared barrel by importing from three leaf files (../shared/features.js, ../shared/data-files.js, ../shared/view-id.js) instead of consolidating to a single `from \"../shared/index.js\"` import. CLAUDE.md's web-shared addition policy mandates barrel-only imports for all consumers. The messaging/ exemption does not cover external.ts. boundary-check.test.ts should add an assertion that no viewer-zone file imports from web-shared leaf paths directly."
recommendationMeta: "[object Object]"
---

## Children

| Title | Status |
|-------|--------|
| [Fix code in web-viewer: boundary-check.test.ts does not assert that viewer→server imports are type-only. (+2 more)](./fix-code-in-web-viewer-boundary-eca99b/index.md) | completed |
