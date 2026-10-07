---
id: "908c0610-1955-4003-8e65-93cbfe6835b7"
level: "task"
title: "Keep a moved node's unknown state fields in state.yaml"
status: "completed"
priority: "high"
startedAt: "2026-10-07T20:02:15.527Z"
completedAt: "2026-10-07T20:10:10.342Z"
endedAt: "2026-10-07T20:10:10.342Z"
resolutionType: "code-change"
resolutionDetail: "writePrdModel now loads every state.yaml under product/ and changes/ before it plans. splitState falls back to the node's row from any folder, so a moved node or one that flipped from leaf to folder keeps its unknown state keys in state.yaml."
acceptanceCriteria: []
description: "From the PR #565 review (finding 1, medium). In packages/rex/src/store/prd-model-writer.ts, splitState (around line 275) treats a field as state only when it is a known state key or when the destination folder's existing state.yaml row for the node already holds it (the previous argument). When a node moves to another folder, or flips from a leaf to a folder, the destination has no row for it yet, so a field that a newer rex build wrote to state.yaml (unknown to this build) is serialized into the Markdown intent, and the old row is dropped with the old folder's state. That breaks the intent/state split and loses the field's provenance. Fix: look up the node's previous state row by id across every state.yaml the writer has loaded (the old folder's included), not only the destination folder, and carry unknown keys from that row into the new row. Do not wire the writer to the store. Acceptance criteria: (1) a node whose state.yaml row holds an unknown key, moved to another parent folder, keeps that key in the destination state.yaml and not in its Markdown frontmatter (regression test that writes, moves, writes and reads back); (2) the same holds for a leaf-to-folder flip; (3) the old folder's state.yaml no longer has the node's row, and no other row changes; (4) the v2 fixture still round-trips byte-identically and the existing reader and writer tests stay green."
lastModified: "2026-10-07T20:10:10.572Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
