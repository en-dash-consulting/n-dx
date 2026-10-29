---
id: "aeddb4e7-bd31-48f0-9c39-b2141226b798"
type: "change"
title: "Apply blocked paths during directory walks"
slug: "apply-blocked-paths-during-directory"
intent: "toolListDirectory and toolSearchFiles in packages/hench/src/tools/files.ts validate only the top-level path argument; every entry reached by recursion is read without a blockedPaths check. Check each entry and skip blocked directories during descent."
acceptanceCriteria:
  - "list_directory and search_files run every visited entry through the guard's blocked-path check and do not descend into a blocked directory"
  - "A unit test asserts search_files never returns a line from .env, .hench/, .rex/, .git/ or .n-dx.local.json, and list_directory never lists their contents"
  - "The secret-path patterns from the language baseline apply to search_files as they do to read_file"
priority: "high"
source: "ndx-capture"
---
