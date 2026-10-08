---
id: "286661e3-a723-4331-ae03-49beb5b07e4d"
level: "task"
title: "Match the computed edges to the design: touches, cancelled changes and inherited bindings"
status: "pending"
priority: "medium"
description: "Pre-freeze review finding 10 (2026-10-07, Ryan). Does not need PR 30.\n- changedBy is the inverse of amends and touches (the design table says so); today it inverts amends only.\n- Cancelled and deleted changes contribute no edges: not to changedBy, coChanges or realizedBy. Today a cancelled change inflates coChanges and feeds realizedBy files, which placement weights highest, so a dead change steers future placements.\n- A constraint whose appliesTo names an area or a capability binds that node's descendant capabilities too (boundBy), so the agent brief sees every rule that binds a capability.\nTests for each point."
lastModified: "2026-10-08T00:04:26.977Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
