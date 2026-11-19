---
id: "80119310-9c96-474f-9c98-748428cd9148"
type: "change"
title: "Read-only directories in Codex scratch turn completed spawns into cleanup failures"
slug: "read-only-directories-in-codex-scratch"
summary: "A tool that leaves a read-only package in temporary storage can make a successful run appear to fail and leave files on disk."
intent: "Medium, should-fix. A non-root POSIX process leaves a populated directory with mode 0555 under its private temporary directory. At packages/llm-client/src/codex-cli-provider.ts, createCodexScratch().dispose() throws EACCES from unlink. Both completion and Hench call dispose in finally, replacing the original result or error. The process-exit retry sees the same permissions. This was reproduced with a single ordinary file. The existing tests use writable contents. Follow up with bounded cleanup for owned scratch, preserving the child outcome and diagnostics. Any permission repair must stay inside the owned tree, including in the presence of symlinks."
acceptanceCriteria:
  - "A non-root POSIX regression with a populated 0555 scratch subdirectory cleans the owned tree after a successful invocation and returns the original successful result."
  - "A failing invocation with the same scratch contents preserves the original child error and removes the scratch tree while leaving linked external files and directory permissions intact."
touches:
  - "b3cbf38e-4757-4c5b-9a49-663cc8536533"
priority: "medium"
discoveredFrom: {"item":"83b0a2a3-1f01-4f64-8e93-920b6a685b7e","run":"25b4277e-1b02-4a99-960e-a2d72e008fcc"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
