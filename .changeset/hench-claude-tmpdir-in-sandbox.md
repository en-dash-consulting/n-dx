---
"@n-dx/hench": patch
---

Point the Claude CLI's temp root (`CLAUDE_CODE_TMPDIR`) at the sandbox's private scratch directory, so a sandboxed session no longer fails opening `/tmp/claude-<uid>`.
