---
id: "731ea4c3-f02c-4ffb-a2bd-b5c9fea47424"
level: "task"
title: "Address anti-pattern issues (10 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-09T23:37:56.518Z"
completedAt: "2026-03-09T23:48:33.276Z"
description: "- architecture-policy.test.js packageFamily() uses colon-based splitting to identify intra-package zones and skip them from cycle detection. But zones.json uses slash-delimited IDs ('web-viewer/web-server'), not colon-delimited ones. The intra-package exemption never fires — all zone cycles including intra-package sub-zone cycles are subject to CI failure. The code comment is misleading and the function should either be updated to use slash-splitting or removed if the stricter all-cycles behavior is intentional.\n- The messaging/ exemption in boundary-check.test.ts (lines 74-80) creates an unmonitored bypass: viewer/messaging/ files can import directly from shared/ without going through external.ts. This exemption is undocumented in CLAUDE.md and may expand silently as new messaging files are added — each new bypass weakens the gateway contract without triggering the enforcement test.\n- No e2e tests cover the HTTP MCP transport layer (session creation, Mcp-Session-Id header, streaming responses, rex/sourcevision endpoint contracts). All MCP contract tests use stdio spawning. If the HTTP transport regresses, no test in this zone catches it — this is a coverage gap for the primary recommended transport.\n- Two build runner scripts (build.js, dev.js) are colocated with viewer UI utilities in the same zone. Build infrastructure and UI components have completely different change frequencies, owners, and test strategies — colocation forces unrelated coupling metrics onto both populations and should be resolved by zone pins before any health thresholds are applied to this zone.\n- Integration tests messaging-stack.test.ts and request-dedup.test.ts are co-located with the messaging zone but test cross-zone subjects (request-dedup.ts is canonically in web-shared). When these tests fail, blame is ambiguous between the two zones — move them to a root-level integration test directory or to the zone that owns the primary subject under test.\n- fetch-pipeline.test.ts has no corresponding production file in this zone — it likely tests a file from web-viewer (fetch pipeline lives in the viewer, not the messaging infrastructure). This misplaced test inflates viewer-messaging-stack's test count and leaves web-viewer's fetch-pipeline file without a co-located test, causing coverage attribution errors in both zones.\n- boundary-check.test.ts enforces the server/viewer intra-package boundary (three test cases: no server→viewer, no viewer→server, viewer cross-boundary imports through external.ts) but lives in a zero-cohesion residual zone instead of being co-located or cross-referenced with domain-isolation.test.js — the two enforcement tests are now split across two different zones with no shared discoverability path, creating a gap in architectural guardrail visibility.\n- graph-interaction.test.ts and graph-zoom.test.ts import nothing from viewer source files (import graph shows only vitest), so their zone attribution is driven purely by file path rather than import structure — these tests cannot be automatically associated with their implementation subjects by import-graph analysis, making viewer component refactors more likely to leave these tests silently orphaned.\n- The zone ID 'web-dashboard' is shared by both the 372-file main zone (cohesion 0.98) and the 4-file MCP route sub-zone (cohesion 0.40) — any tooling that aggregates zone metrics by ID will silently conflate these two structurally distinct groups, producing a blended cohesion figure that is neither representative of the gateway-enforced main zone nor the loosely coupled MCP route cluster. This is a metrics-integrity defect, not just a naming issue.\n- God function: cmdAnalyze in packages/sourcevision/src/cli/commands/analyze.ts calls 32 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

## Subtask: Fix zone pins and document exemptions for anti-pattern findings

**ID:** `29c2ecf7-f569-44f1-b281-e033da200d45`
**Status:** completed
**Priority:** critical

Address the actionable anti-pattern findings:
1. Pin build.js/dev.js to web-build-infrastructure zone (separate from viewer UI)
2. Pin fetch-pipeline.test.ts to viewer-message-pipeline zone
3. Document messaging/ exemption in CLAUDE.md gateway rules
4. Add cross-reference between boundary-check.test.ts and domain-isolation.test.js
5. Add source imports to graph-interaction/graph-zoom tests
6. Acknowledge already-resolved findings (packageFamily colon splitting, test relocations, cmdAnalyze decomposition, zone ID collision)

---

## Subtask: Add HTTP MCP transport e2e test coverage

**ID:** `60f5953b-4958-4c94-b996-086f843501aa`
**Status:** completed
**Priority:** high

Create e2e tests for HTTP MCP transport: session creation, Mcp-Session-Id header, streaming responses, rex/sourcevision endpoint contracts. Currently all MCP tests use stdio transport only.

---
