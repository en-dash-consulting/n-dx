---
id: "95666ab1-b2ee-4559-a40b-d1b221448c6f"
level: "task"
title: "Migrated product nodes read met when their v1 item completed"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "lane-migration"
  - "rex"
  - "graview"
source: "ndx-capture"
acceptanceCriteria:
  - "classifyV1Tree marks a capability or constraint entry met: true when its v1 item's status is completed, and leaves it unset otherwise"
  - "buildPlanData sets ItemPlanData.metAt to specHash of the capability's drafted spec for every met capability entry, and never for an unmet one"
  - "proposeProductLayer in @n-dx/graview stamps metAt on every met capability and constraint it builds, so computeProductStatus reports intentStatus met for a completed v1 feature with no open amending change, changing when one is open, and proposed for a pending feature"
  - "The projection's capability declaration no longer carries metAt as a datetime (it is a spec hash in rex); standing is read from intentStatus"
  - "Unit tests cover the rules stage, the data stage and the proposed layer; the adapter's v1 fixture test asserts a met capability"
description: "computeProductStatus says a capability or constraint is met only when metAt holds its spec hash, and only applyAmendments stamps it. The migration plan never does, so every capability the plan draws from a completed v1 feature reads proposed, in the Graview projection today (287 of 294 on this repository) and in the migrated tree once the plan is applied. The data stage already stamps appliedAt on applied changes for the same reason (\"without it the change would read as changing forever\"); product nodes need the matching stamp. The rules stage marks the entry met when the v1 item is completed (PlanEntry.met); the data stage stamps ItemPlanData.metAt with specHash of the drafted spec for a capability; the adapter's proposed layer stamps metAt from the node spec it builds so rex's own status rule says met, changing or revised with no adapter-side judgement. A pending feature with completed work stays proposed; a completed one with an open amending change reads changing, as rex's rule already says."
lastModified: "2026-10-11T03:32:11.048Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
