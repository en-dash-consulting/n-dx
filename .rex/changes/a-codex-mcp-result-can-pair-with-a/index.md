---
id: "cde3b8f7-640e-472b-9b96-a3f578edefa6"
type: "change"
title: "A Codex MCP result can pair with a stale earlier-turn call that reused its item id, leaving the current call pending"
slug: "a-codex-mcp-result-can-pair-with-a"
intent: "Verdict: should-fix (severity low). Found by the adversarial review of task f7893c86 (run 938ad54e).\n\nparseCodexJsonLine now puts the Codex item id (`item_1`, `item_2`, …) on mcp_tool_call tool uses and results (packages/llm-client/src/vendor-session-driver.ts). The Sidecar drawer's pairToolResults (packages/web/src/viewer/components/sidecar-drawer.ts:139-159) pairs an id-carrying result with the FIRST open call that has that id, across the whole session transcript. Codex numbers items per `codex exec` process, so ids appear to restart each turn (the verbatim codex-cli 0.164.0-alpha.11.1 probe runs each start at item_1); this is inferred from those probes, not confirmed on a resumed turn.\n\nFailure scenario: turn 1 issues an ndx-sidecar call item_1 and is interrupted (stopped, killed, timeout) before item.completed, so the call stays open. Turn 2 issues another call item_1 that completes. Its result pairs with turn 1's stale call. Turn 2's row reads \"No result yet\", and turn 1's row shows turn 2's output and status.\n\nReachability: only once Codex Sidecar sessions are allowed (sibling task \"Stop refusing Codex Sidecar sessions…\" in change codex-sidecar-sessions-get-the-ndx). Today CODEX_SIDECAR_UNAVAILABLE refuses them.\n\nOptions:\n- A (recommended): in pairToolResults, match an id only within the same turn (the frame's event.turn), or discard open calls when a new turn starts. Cost: a few lines plus a viewer test. Risk: low. Claude ids are globally unique, so turn scoping does not change them.\n- B: prefix Codex ids with the turn in the parser (e.g. `t<turn>:item_1`). Cost: parser-only. Risk: depends on `turn` being the session turn rather than a per-process counter; check before choosing.\n\n2026-11-24 reconciliation: PR 3 owns reproduction and turn-scoped pairing. Current source still searches first open matching id across transcript, but real resumed CLI id reuse remains unproven. Preserve both acceptance criteria; add deterministic two-turn interruption regression and real CLI observation, with any unavailable observation honestly open. Historical CODEX_SIDECAR_UNAVAILABLE prose is not current reachability evidence."
acceptanceCriteria:
  - "A Codex tool result carrying item id X pairs with the open call X from its own turn, not with an unanswered call X from an earlier turn (viewer test with two turns that both use item_1, the first left unanswered)"
  - "The earlier turn's unanswered call still shows No result yet after the later turn's result arrives"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
priority: "low"
discoveredFrom: {"item":"f7893c86-bb20-487e-bb38-3863d250f8a1","run":"938ad54e-99ba-4b46-a6fa-4ccb52859dca"}
run: {"tier":"heavy","models":{"codex":"gpt-6-astra"},"provider":"cli","review":true,"reviewMode":"self","reviewTier":"heavy","reviewModels":{"codex":"gpt-6.2-astra"},"reviewOptional":false,"skipTestGate":false,"contextNotes":"User reconfirmed prior Codex stack settings on 2026-11-24: isolated owner checkout only; Codex CLI executor gpt-6-astra and mandatory fresh distinct gpt-6.2-astra self-review. Preserve auth and explicit pins; no fallback or global config edits. Local vendor selection must be explicit and resolved before work because main pins Claude. Test gate stays enabled; no inherited historical --skip-test-gate invocation. One task per invocation. Read docs/coordination/codex-hardening-stack.md and the launch packet. No subagents or user-owned chat creation authorized. Do not merge. Use supported PRD operations and atomic code/PRD commits, scoped patch changesets and final attribution trailers. Unsupported native policy/account/version evidence remains open; mocks are not real CLI/account/browser evidence."}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "codex-hardening"
  - "slot-3"
source: "ndx-adversarial-review"
blockedBy:
  - "262fd7de-b9da-4954-9cc8-bd159e25e3de"
---
