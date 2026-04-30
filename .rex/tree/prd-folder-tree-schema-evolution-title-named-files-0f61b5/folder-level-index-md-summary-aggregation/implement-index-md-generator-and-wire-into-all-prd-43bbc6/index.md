---
id: "43bbc65d-fcd9-4709-b024-6ab1b1f13131"
level: "task"
title: "Implement index.md generator and wire into all PRD write paths"
status: "pending"
priority: "high"
tags:
  - "rex"
  - "prd"
  - "storage"
source: "smart-add"
acceptanceCriteria:
  - "Generator produces deterministic output given the same input subtree (no timestamps that vary across regenerations)"
  - "Every PRDStore write triggers regeneration of `index.md` for the changed folder and all ancestor folders up to the tree root"
  - "Concurrent-write safety: regeneration runs inside the existing write lock, no partial files left on disk"
  - "Move/rename operations regenerate both the old and new ancestor chains"
  - "Unit tests cover each write op and assert post-write `index.md` content"
  - "End-to-end test exercises CLI add/edit/move and verifies on-disk index.md state"
description: "Build a generator that, given a folder path and the in-memory PRD subtree rooted at that folder, produces the new `index.md` content per the schema. Wire generator calls into every PRD write operation in PRDStore (add, edit, move, merge, status update, remove) so that the affected ancestor folders' `index.md` files are always rewritten in the same transaction. Ensure no concurrent-write corruption by reusing the existing folder-tree write lock."
---
