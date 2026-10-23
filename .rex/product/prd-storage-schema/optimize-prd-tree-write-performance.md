---
id: "6e8679d3-2efa-4b4b-b6b6-d7b23f422a71"
type: "capability"
title: "Optimize prd_tree Write Performance for Add and Edit Commands"
slug: "optimize-prd-tree-write-performance"
statement: "The system writes changes to the PRD folder tree atomically and quickly when an item is added or edited."
criteria: [{"id":"c1","text":"When a single item is added with ndx add to a 1000-item PRD, the system shall complete the add in under 500ms (median across 10 runs)."},{"id":"c2","text":"The system shall write every index.md in the PRD folder tree to a temporary file and then rename it into place, so a crash during the write cannot leave a partially written index.md."},{"id":"c3","text":"When a single item is added or edited, the system shall write only the affected item's directory and its parent's index.md, without re-serializing the whole PRD folder tree."},{"id":"c4","text":"If a second writer tries to change the PRD folder tree while another writer holds it, the system shall reject the second writer so the tree is not corrupted."}]
source: "smart-add"
---

Profile and optimize the folder-tree write path so that ndx add, rex add, edit_item, and other prd_tree-mutating commands complete quickly and atomically. Target sub-500ms latency for single-item adds on PRDs with hundreds of items, and ensure writes are crash-safe (no partial writes leaving orphan directories or half-written index.md files).
