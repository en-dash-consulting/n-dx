---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Test-only: vitest keeps console output for failing tests and drops it for passing ones (`silent: "passed-only"`). A green run of the monorepo no longer prints thousands of lines of task briefs, init summaries and fixture warnings. No production code changed.
