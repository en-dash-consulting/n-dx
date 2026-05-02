---
id: "6e8679d3-2efa-4b4b-b6b6-d7b23f422a71"
level: "feature"
title: "Optimize prd_tree Write Performance for Add and Edit Commands"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Profile and optimize the folder-tree write path so that ndx add, rex add, edit_item, and other prd_tree-mutating commands complete quickly and atomically. Target sub-500ms latency for single-item adds on PRDs with hundreds of items, and ensure writes are crash-safe (no partial writes leaving orphan directories or half-written index.md files)."
---

## Children

| Title | Status |
|-------|--------|
| [Implement atomic, fast write path for prd_tree mutations with crash-safety guarantees](./implement-atomic-fast-write-962cd7/index.md) | completed |
| [Profile prd_tree write path and identify bottlenecks for single-item add and edit operations](./profile-prd-tree-write-path-and-bbf2dd/index.md) | pending |
