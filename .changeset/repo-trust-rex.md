---
"@n-dx/rex": patch
---

`verify_criteria` (MCP) no longer runs the repository's test command by default: `runTests` defaults to false, and even when true the command runs only once the repository's execution config is trusted (`ndx trust`). The criteria-to-test mapping is always returned; a skipped run says why.
