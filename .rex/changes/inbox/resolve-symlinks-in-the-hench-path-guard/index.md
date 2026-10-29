---
id: "36f6958f-52dd-47c2-bbe8-e3f3945fb260"
type: "change"
title: "Resolve symlinks in the hench path guard"
slug: "resolve-symlinks-in-the-hench-path-guard"
intent: "validatePath in packages/hench/src/guard/paths.ts checks the lexical path only. Resolve the real path (nearest existing ancestor for files not yet created) before the containment and blockedPaths checks, and apply the same to the run_command cwd in tools/shell.ts. See the security advisory for the audit detail."
acceptanceCriteria:
  - "validatePath resolves the real path of the resolved target (or its nearest existing ancestor) and refuses any real path outside realpath(projectDir)"
  - "A symlink inside the project that points outside is refused by read_file, write_file and run_command cwd, each covered by a unit test"
  - "Existing lexical traversal, null-byte and absolute-path tests still pass"
priority: "critical"
source: "ndx-capture"
---
