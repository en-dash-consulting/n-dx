---
id: "e18b93c0-a4b0-4f46-b4d9-9ce2d4ef0d6c"
type: "task"
title: "A crash mid ledger_append glues the next ledger entry onto the fragment, and every cold Sidecar turn then fails"
slug: "a-crash-mid-ledger-append-glues-the"
description: "Scenario: the dashboard server dies while appendLedgerEntry (packages/web/src/server/sidecar/ledger.ts) writes a line, leaving a last line with no newline. The next ledger_append glues a whole entry onto that fragment, so the file now has a malformed line in the middle. readLedger throws on a malformed middle line. A session marked for a cold start calls it on every turn (session-registry.ts runTurn → context.ledger), so every later turn of that session rejects before it spawns, and the refresh mark is never cleared. The session is bricked until someone edits the file by hand.\n\nReachable through POST /api/sidecar/sessions/:id/turns once a session has checkpointed, after a server kill during the checkpoint turn's ledger_append. That's rare because the lines are short. The transcript had the same defect and was fixed by dropPartialTail in session-registry.ts.\n\nVerdict: should-fix (adversarial review of 777869b8). It's real but needs a crash at the exact moment of the write.\n\nOptions:\n1. (Recommended) Before appending, cut a partial last line into `<id>.ledger.jsonl.corrupt`, as dropPartialTail does for transcripts. It's cheap and keeps the strict reader.\n2. Have readLedger skip and report malformed lines. That conflicts with the rule against swallowing errors unless the skip is surfaced, for example as a count in the context-refreshed frame."
acceptanceCriteria:
  - "After a ledger file is left with a partial last line, the next appendLedgerEntry produces a file readLedger parses without throwing, and the fragment is kept in a .corrupt file"
  - "A test leaves a partial ledger line, appends an entry, and asserts the next cold turn spawns with that entry in its prompt"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
