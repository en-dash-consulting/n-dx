---
id: "05447510-b86b-445c-ac6a-b48d24f286aa"
type: "change"
title: "Read and write per-folder state.yaml through one module"
slug: "read-and-write-per-folder-state-yaml"
intent: "rex/src/store/state-writer.ts: load and save state.yaml rows keyed by id, deterministic key order, LF line endings, writes inside the PRD lock. Keys the writer does not recognise survive every write, so older 1.x installs never drop fields added later."
acceptanceCriteria:
  - "Round-trip keeps unknown keys byte-identical (test)"
  - "Writes are deterministic for the same input (test)"
  - "All writes happen under withTransaction"
  - "revisedAt is stamped when a spec edit first makes the spec hash differ from metAt, kept across later edits and state writes (checks, specReviewed), and cleared whenever the spec hash equals metAt again, by a re-stamp or a revert to the met text, so a later revision never inherits an earlier one's age (test; see ItemState.revisedAt in schema/v2.ts)"
touches:
  - "30dbd22d-d325-4345-a66f-a1a8aa6a10f1"
priority: "high"
tags:
  - "pr-08"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
---
