---
id: "cde3b8f7-640e-472b-9b96-a3f578edefa6"
type: "change"
title: "A Codex MCP result can pair with a stale earlier-turn call that reused its item id, leaving the current call pending"
slug: "a-codex-mcp-result-can-pair-with-a"
intent: "Verdict: should-fix (severity low). Found by the adversarial review of task f7893c86 (run 938ad54e).\n\nparseCodexJsonLine now puts the Codex item id (`item_1`, `item_2`, …) on mcp_tool_call tool uses and results (packages/llm-client/src/vendor-session-driver.ts). The Sidecar drawer's pairToolResults (packages/web/src/viewer/components/sidecar-drawer.ts:139-159) pairs an id-carrying result with the FIRST open call that has that id, across the whole session transcript. Codex numbers items per `codex exec` process, so ids appear to restart each turn (the verbatim codex-cli 0.164.0-alpha.11.1 probe runs each start at item_1); this is inferred from those probes, not confirmed on a resumed turn.\n\nFailure scenario: turn 1 issues an ndx-sidecar call item_1 and is interrupted (stopped, killed, timeout) before item.completed, so the call stays open. Turn 2 issues another call item_1 that completes. Its result pairs with turn 1's stale call. Turn 2's row reads \"No result yet\", and turn 1's row shows turn 2's output and status.\n\nReachability: only once Codex Sidecar sessions are allowed (sibling task \"Stop refusing Codex Sidecar sessions…\" in change codex-sidecar-sessions-get-the-ndx). Today CODEX_SIDECAR_UNAVAILABLE refuses them.\n\nOptions:\n- A (recommended): in pairToolResults, match an id only within the same turn (the frame's event.turn), or discard open calls when a new turn starts. Cost: a few lines plus a viewer test. Risk: low. Claude ids are globally unique, so turn scoping does not change them.\n- B: prefix Codex ids with the turn in the parser (e.g. `t<turn>:item_1`). Cost: parser-only. Risk: depends on `turn` being the session turn rather than a per-process counter; check before choosing."
acceptanceCriteria:
  - "A Codex tool result carrying item id X pairs with the open call X from its own turn, not with an unanswered call X from an earlier turn (viewer test with two turns that both use item_1, the first left unanswered)"
  - "The earlier turn's unanswered call still shows No result yet after the later turn's result arrives"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
discoveredFrom: {"item":"f7893c86-bb20-487e-bb38-3863d250f8a1","run":"938ad54e-99ba-4b46-a6fa-4ccb52859dca"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
