---
id: "a38d6142-bcaa-4fa1-ad57-bbdc413b2cff"
level: "task"
title: "Stop git's autocrlf breaking hench rollback and sigint fixtures"
status: "completed"
priority: "medium"
tags:
  - "cross-os"
  - "windows"
  - "testing"
  - "hench"
  - "line-endings"
source: "exploration-2026-08-17"
startedAt: "2026-08-18T19:41:46.897Z"
completedAt: "2026-08-18T19:41:46.897Z"
endedAt: "2026-08-18T19:41:46.897Z"
acceptanceCriteria:
  - "The temp git repos in these fixtures set core.autocrlf=false so line endings do not depend on the developer's global config"
  - "All three failures pass on Windows"
  - "The content assertions remain byte-exact — no line-ending normalization was added to the comparison"
  - "The same tests still pass on POSIX"
  - "If multiple hench fixtures create git repos, the config is applied via a shared helper rather than duplicated"
description: "Three failures, one cause:\n  expected 'export const x = 1;\\r\n' to be 'export const x = 1;\n'\n\n  tests/integration/rollback-prompt.test.ts — \"reverts tracked changes and removes agent-created\n    untracked files when the prompt is accepted, preserving pre-existing untracked work\"\n  tests/integration/sigint-prompt.test.ts — \"holds the first Ctrl-C during the rollback prompt and\n    keeps the prompt answerable\"\n  tests/integration/sigint-prompt.test.ts — \"still performs rollback when the user accepts the prompt\"\n\nThe fixture repos inherit the developer's global core.autocrlf, which is `true` on this machine (and is\nthe Git-for-Windows default). The test writes LF content, hench rolls the change back via git, and git\nrestores the file with CRLF. That is git behaving exactly as configured — NOT a rollback defect. The\nrollback itself works; only the byte-for-byte content comparison fails.\n\nFIX AT THE FIXTURE, NOT THE ASSERTION. Set `core.autocrlf=false` (and consider `core.eol=lf`) on the\ntemp repo when it is created, so the test controls its own line-ending behaviour instead of inheriting\nthe machine's. That keeps the assertion byte-exact, which is the point: these tests verify that rollback\nrestores the ORIGINAL CONTENT, and normalizing line endings in the comparison would let a rollback that\nsubtly corrupted a file still pass.\n\nNote the repo already treats this class of problem the same way elsewhere — .gitattributes pins n-dx's\nown written files to eol=lf precisely so tool output and git checkout agree. This is the fixture-level\nequivalent.\n\nWHILE HERE: check how many other hench integration tests create a git fixture repo. If several do, add\nthe config in a shared helper rather than in each test, so the next git-fixture test inherits it. Do not\nrefactor unrelated fixtures beyond adding the two config lines."
---
