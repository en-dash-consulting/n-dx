---
id: "66d84d91-cbfb-4a67-9af9-69c14f4b636d"
type: "task"
title: "Placement docs describe what shipped, and the place-change address survives a bad id"
slug: "placement-docs-describe-what-shipped"
description: "Stack review finding on #987 at docs/packages/web.md:128 (review comment 4488638645).\n\n**Should fix: docs describe the ghost bug that was fixed, not what shipped**\n\n\"The ghost follows the form's area and goes when a map pick moves away from it\" describes bf1aba58, the bug that 1252205ca fixed. Now `pickArea` bumps `areaPick` and `ProposeForm` follows it, so a map pick moves the form's area and the ghost moves with it. Suggested wording: \"a map pick of another area moves the form, and its ghost, there; choosing an area in the form moves the map back\". The Candidate cards bullet also says picking another candidate \"keeps your edits\", but switching targets now clears the previous target's criteria edits on purpose; name that exception. The description says the in-app guide was updated, but `guide.ts` is not in this diff. Update it, or drop that claim.\n\nAlso from the brief: update guide.ts or drop the claim from the PR description, and record which in the commit message; guard placeChangeOfTab's decodeURIComponent the same way S6 guards route-state.ts (return null on a malformed id), with a test."
acceptanceCriteria:
  - "docs/packages/web.md describes the ghost block and the candidate cards as shipped (no 'keeps your edits' exception that the code does not have)"
  - "The in-app guide (guide.ts) matches the docs, or the commit message says the claim is dropped from the PR description instead"
  - "placeChangeOfTab guards decodeURIComponent and returns null for a malformed id, with a test"
---
