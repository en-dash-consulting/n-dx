---
id: "6d269c81-4eec-401b-95a0-85d7756677bd"
level: "task"
title: "Address pattern issues (3 findings)"
status: "completed"
priority: "high"
source: "sourcevision"
startedAt: "2026-03-11T04:43:23.164Z"
completedAt: "2026-03-11T04:47:42.271Z"
resolutionType: "code-change"
resolutionDetail: "Added 3 new architectural policy tests: (1) production→test boundary enforcement in domain-isolation.test.js, (2) sub-zone barrel enforcement in boundary-check.test.ts ensuring crash imports go through crash/index.ts, (3) registered crash/index.ts as internal barrel in gateway-rules.json for re-export-only enforcement"
acceptanceCriteria: []
description: "- The domain-isolation.test.js in the E2E zone is the only automated guard against the web-viewer → web-unit boundary violation identified above — verify it explicitly asserts that no production viewer file imports from a test zone, as this class of violation may not be caught by the current gateway-only checks.\n- No policy test currently verifies that web-viewer's 2 inbound imports to crash target only crash/index.ts — direct imports into crash/crash-detector.ts or crash internals would erode encapsulation without failing any existing test\n- Neither boundary-check nor build-output-contract validates that web-viewer's inbound imports to viewer sub-zones (crash, panel) enter only through declared barrel files — internal encapsulation of viewer sub-zones is outside the current test scope"
recommendationMeta: "[object Object]"
---
