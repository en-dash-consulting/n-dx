---
id: "3b63c3c5-08b4-4aee-805d-7e4d56a910b1"
level: "task"
title: "import-bundle writes no execution-log entry — the only PRD-mutating command that leaves no trace"
status: "pending"
priority: "medium"
tags:
  - "pr-review"
  - "severity:medium"
source: "pr-review"
acceptanceCriteria:
  - "A successful import appends one structured log entry with mode, added and replaced counts, and bundle provenance"
  - "A rejected or declined import appends nothing"
  - "Test asserts the entry lands in .rex/execution-log.jsonl for both merge and replace"
description: "Verdict: valid (verified). Sixteen command modules call store.appendLog — every other write path (add, update, move, remove, prune, reshape, reorganize, fix, smart-add, sync). cmdImportBundle writes nothing to .rex/execution-log.jsonl, which CLAUDE.md documents as the append-only activity record. After an import, nobody can answer where the items came from, who ran it, or whether it was merge or replace; the dashboard activity view shows a PRD that changed size with no cause. Matters most on --replace, the command that can discard the whole tree.\n\nSolution: appendLog after the transaction with event (e.g. \"bundle_imported\"), mode, added/replaced counts, bundle exportedAt, and exportedFrom provenance (branch/commit) when present. appendLog is on the PRDStore contract (store/contracts.ts:163) and available on the resolved store."
lastModified: "2026-09-10T19:10:43.919Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
