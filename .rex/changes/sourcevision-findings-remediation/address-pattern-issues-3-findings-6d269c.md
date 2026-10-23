---
id: "6d269c81-4eec-401b-95a0-85d7756677bd"
type: "task"
title: "Address pattern issues (3 findings)"
slug: "address-pattern-issues-3-findings-6d269c"
description: "- The domain-isolation.test.js in the E2E zone is the only automated guard against the web-viewer → web-unit boundary violation identified above — verify it explicitly asserts that no production viewer file imports from a test zone, as this class of violation may not be caught by the current gateway-only checks.\n- No policy test currently verifies that web-viewer's 2 inbound imports to crash target only crash/index.ts — direct imports into crash/crash-detector.ts or crash internals would erode encapsulation without failing any existing test\n- Neither boundary-check nor build-output-contract validates that web-viewer's inbound imports to viewer sub-zones (crash, panel) enter only through declared barrel files — internal encapsulation of viewer sub-zones is outside the current test scope"
priority: "high"
source: "sourcevision"
---
