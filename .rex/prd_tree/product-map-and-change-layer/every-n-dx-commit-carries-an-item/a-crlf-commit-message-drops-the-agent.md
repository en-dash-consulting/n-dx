---
id: "67f17f2b-c930-4f62-8a78-40f056e64f4b"
level: "task"
title: "A CRLF commit message drops the agent's own trailers out of the final trailer block"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A work commit whose agent message uses CRLF line endings and ends in its own Co-Authored-By trailer has that trailer in git's `%(trailers:only)` output alongside N-DX-Item (test, asserted through git's parser)"
  - "appendTrailerBlock does not repeat a hench trailer that the agent's CRLF final block already contains verbatim (test)"
description: "Verdict: should-fix (severity low).\n\nFailure scenario: an agent writes `.hench-commit-msg.txt` with CRLF line endings, e.g. \"feat: x\\r\\n\\r\\nCo-Authored-By: Claude <c@c>\\r\\n\". appendTrailerBlock (packages/hench/src/agent/lifecycle/commit-trailers.ts:52) splits paragraphs on /\\n[ \\t]*\\n/. That pattern does not match \"\\n\\r\\n\", so it sees a single paragraph and starts a new block after a blank line. git commit strips the \\r characters, and the result is \"feat: x / blank / Co-Authored-By: Claude / blank / hench's trailers\". Reproduced: `%(trailers:only)` returns only hench's trailers, and the agent's Co-Authored-By is body text, so GitHub drops that co-author. N-DX-Item is still readable.\n\nReachability: the commit-prompt path in performCommitPromptIfNeeded on any agent or editor that writes CRLF, which mostly means Windows. Not covered by any test.\n\nFix (recommended): normalise line endings first with `message.replace(/\\r\\n?/g, \"\\n\")` before splitting. This is one line plus a test, with no real risk, because git strips the \\r anyway."
lastModified: "2026-10-09T03:42:13.892Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
