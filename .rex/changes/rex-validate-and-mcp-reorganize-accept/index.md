---
id: "517cc0de-c312-447f-ab0b-065fdcd9cd38"
type: "change"
title: "rex validate and MCP reorganize accept a change nested two deep"
slug: "rex-validate-and-mcp-reorganize-accept"
intent: "Review 2026-10-12, PR #687 should-fix (CONFIRMED, reproduced).\n\nDefect: packages/rex/src/core/layer-projection.ts:46 projects every nested change as `feature`, and packages/rex/src/cli/commands/validate.ts:183 (\"hierarchy placement\") then checks the v1 LEVEL_HIERARCHY. A change nested two deep projects as a feature under a feature, which validate reports as an error, yet changeLayerParentRule (core/move.ts) allows a change under a change at any depth and ChangeLayerStore's newErrors check accepts the write.\n\nFailure scenario (reproduced on a v2 copy): `rex add change` twice, then `rex move <tidy> --parent=<CH-1>`, then `rex move <second> --parent=<tidy>`. Both moves succeed. `rex validate .` then fails with `✗ hierarchy placement \"868466d9…\" (feature): feature at under feature, expected under epic`, exit code 1, so `ndx ci`'s validate step fails the same way. MCP `reorganize` on the same tree proposes a v1 \"collapse single-child feature\" of the two changes. cli-v2-serve.test.ts \"validate passes\" runs only on the one-change fixture, so the tests miss it.\n\nFix: when the store is the change layer, skip the v1 hierarchy-placement check (and the \"empty containers\" warning, since a task-less change is a legal unit), or check placement with changeLayerParentRule instead. MCP reorganize must not propose v1 level collapses (single-child feature collapse) on the change layer."
acceptanceCriteria:
  - "On a v2 copy where `rex move` has nested a change two deep (change under change under change), `rex validate .` exits 0 with no hierarchy-placement error (test that fails on 91865a3c2a)"
  - "A task-less change raises no empty-container warning on v2 (test)"
  - "MCP reorganize on that tree proposes no v1 level collapse of the nested changes (test)"
  - "v1 validate and reorganize output is unchanged; existing tests pass unedited"
touches:
  - "40cb95a7-c1d5-4fd0-8041-74c7a928215f"
priority: "high"
tags:
  - "pr-33"
  - "review-2026-10-12"
  - "lane-rex-store"
source: "review-2026-10-12"
---
