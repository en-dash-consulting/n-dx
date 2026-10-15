---
id: "333f622f-2ea5-4f6b-9d41-97316ee009c4"
level: "task"
title: "pack add --from keeps the working install until the new bundle loads, and refuses a null manifest cleanly"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "sourcevision"
  - "offline"
  - "ndx-adversarial-review"
  - "pr-12b"
blockedBy:
  - "10c102ff-33f7-4c28-bc9f-fa2d07732d92"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A bundle that fails after extraction leaves the previous install of that pack in place and loadable (test)"
  - "A bundle whose manifest is `null` is refused as not a pack bundle (test)"
  - "sourcevision tests and the root policy suites pass"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "Two findings from the review of ac7a26e1 (run 42d6e9f1, commit aa1a348b1), dropped by the reviewer as low and kept by the operator because the offline path is exactly where a user cannot recover by re-downloading.\n\n1. `sv pack add <lang> --from <bundle>` (packages/sourcevision/src/cli/commands/pack.ts and pack-archive.ts) deletes the existing install of that pack before it has proved the bundle's pack loads. On a machine with no registry access, a bad bundle (wrong contents that pass the manifest check, a truncated archive, a pack that fails to load) leaves the user with no pack at all. Extract into a temporary directory beside the pack dir, load the pack from there through pack-loader.ts, and only then replace the existing install (rename into place); on any failure, leave the existing install untouched and remove the temporary directory.\n2. A bundle whose manifest JSON is `null` (or not an object) crashes with a TypeError; refuse it as \"not a pack bundle\", as for a missing manifest.\n\nTests: a failing bundle leaves a pre-existing install in place and loadable; a null manifest is refused with the \"not a pack bundle\" message. Injected npm runner and temp ndx home only. No package.json dependency changes; do not touch rex, hench, core or web source."
lastModified: "2026-10-15T05:00:45.385Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
