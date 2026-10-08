---
id: "4d1c098c-aa8b-489c-baf1-4dc9499f89a4"
level: "task"
title: "Stamp appliedAt and reviewedHash when migrating historical items"
status: "pending"
priority: "high"
acceptanceCriteria: []
description: "From the pre-freeze schema decisions (PR 30, 2026-10-07). A change is applied only when appliedAt is set, so a migrated historical change without appliedAt would read changing forever, and a migrated product node without reviewedHash would read unreviewed. The migration plan stamps appliedAt on changes that were applied in v1 (completed items whose product effect is already in the migrated product layer), using the best available time (completion time, else the plan's cut time), and stamps reviewedHash on product nodes the plan marks reviewed (the specHash of the migrated spec). It does not write appliedIn or specReviewed, which are retired."
lastModified: "2026-10-08T00:02:33.159Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
