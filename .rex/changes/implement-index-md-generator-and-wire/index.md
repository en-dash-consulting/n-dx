---
id: "43bbc65d-fcd9-4709-b024-6ab1b1f13131"
type: "change"
title: "Implement index.md generator and wire into all PRD write paths"
slug: "implement-index-md-generator-and-wire"
intent: "Build a generator that, given a folder path and the in-memory PRD subtree rooted at that folder, produces the new `index.md` content per the schema. Wire generator calls into every PRD write operation in PRDStore (add, edit, move, merge, status update, remove) so that the affected ancestor folders' `index.md` files are always rewritten in the same transaction. Ensure no concurrent-write corruption by reusing the existing folder-tree write lock."
acceptanceCriteria:
  - "Generator produces deterministic output given the same input subtree (no timestamps that vary across regenerations)"
  - "Every PRDStore write triggers regeneration of `index.md` for the changed folder and all ancestor folders up to the tree root"
  - "Concurrent-write safety: regeneration runs inside the existing write lock, no partial files left on disk"
  - "Move/rename operations regenerate both the old and new ancestor chains"
  - "Unit tests cover each write op and assert post-write `index.md` content"
  - "End-to-end test exercises CLI add/edit/move and verifies on-disk index.md state"
amends: [{"target":"722b727d-718f-4012-aa28-25e0af91def5","delta":"modified","summary":"Implement index.md generator and wire into all PRD write paths","base":"c5a6d7db98048c68d87de97aaf0222a8240035ac33c56d0d8152565c8018c930"}]
priority: "high"
tags:
  - "rex"
  - "prd"
  - "storage"
source: "smart-add"
---
