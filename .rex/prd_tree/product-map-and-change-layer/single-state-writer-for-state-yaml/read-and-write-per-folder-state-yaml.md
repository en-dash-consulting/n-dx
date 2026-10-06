---
id: "05447510-b86b-445c-ac6a-b48d24f286aa"
level: "task"
title: "Read and write per-folder state.yaml through one module"
status: "pending"
priority: "high"
tags:
  - "pr-08"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
acceptanceCriteria:
  - "Round-trip keeps unknown keys byte-identical (test)"
  - "Writes are deterministic for the same input (test)"
  - "All writes happen under withTransaction"
  - "revisedAt is stamped when a spec edit first makes the spec hash differ from metAt, kept across later edits and state writes (checks, specReviewed), and cleared when metAt is re-stamped (test; see ItemState.revisedAt in schema/v2.ts)"
description: "rex/src/store/state-writer.ts: load and save state.yaml rows keyed by id, deterministic key order, LF line endings, writes inside the PRD lock. Keys the writer does not recognise survive every write, so older 1.x installs never drop fields added later."
lastModified: "2026-10-06T04:16:54.193Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
