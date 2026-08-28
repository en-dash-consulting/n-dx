---
"@n-dx/web": patch
"@n-dx/core": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

Add Gemini support to the dashboard LLM Provider view, and complete the documentation cleanup

The dashboard offered claude / codex / local only, so a project configured with
`llm.vendor google` could not see or edit its model settings there and
`llm.google.*` was absent from the config API response. Gemini is now a
first-class vendor in that view.

Also completes the outstanding documentation findings: removes the removed
`prd.md` + `prd.json` dual-write architecture from the rex README (including an
unreplaced `![img_here](img_here)` placeholder that shipped to npm), corrects
the Node floor to match `engines: >=22`, completes the command references, and
deletes or archives superseded docs.
