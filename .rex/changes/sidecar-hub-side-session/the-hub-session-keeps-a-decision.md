---
id: "26ddda60-dd72-4d59-b529-2570bbd13a32"
type: "task"
title: "The hub session keeps a decision ledger and hands off to worktree sessions"
slug: "the-hub-session-keeps-a-decision"
description: "Story 26 (CAOS 3f7a80b7-1924-8129-8930-ed402a873f0b). Hub ledger plus 'Open in worktree sidecar'. Design §4.4, §6 Drill down; mocks Hub and Drawer states · D."
acceptanceCriteria:
  - "<ndx home>/hub/ledger.jsonl holds the hub session's typed entries, written only through the broker's ledger_append; the ledger types gain decision-needed and handoff"
  - "After a checkpoint (cold turn) and after a hub restart, the next turn's prompt carries the hub ledger; a test covers both"
  - "'Open in worktree sidecar' on a snapshot item creates or resumes that worktree's session on its project server through the hub, appends a handoff entry to that session's ledger naming the hub's question, and opens that worktree's drawer"
  - "A project-server read route returns each worktree session's latest unfinished and decision entries, and the snapshot shows them per worktree within its 8k cap"
priority: "medium"
source: "caos"
---
