---
id: "2f427fb8-b2cb-4dba-9010-370014f56819"
level: "task"
title: "Add rex release stamp and call it from the Version Packages workflow"
status: "pending"
priority: "medium"
tags:
  - "pr-22"
  - "lane-core-docs"
  - "rex"
  - "core"
source: "roadmap"
acceptanceCriteria:
  - "Stamping is idempotent (test)"
  - "Tag-based derivation matches stamping on a fixture repo"
  - "The release workflow runs the step"
description: "rex release stamp <version> stamps shippedIn on every change applied since the previous release tag and, under applyOn release, applies pending completed changes. n-dx's own release workflow calls it in the Version Packages PR. When no stamp exists, derive shippedIn from the first tag containing the apply commit."
lastModified: "2026-10-06T04:18:29.597Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
