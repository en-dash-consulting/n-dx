---
"@n-dx/llm-client": patch
---

Add repository trust: `evaluateRepoTrust` reads what a checkout ships as execution config (`.hench/config.json` guard and permission mode, `.rex/config.json` test command, `.mcp.json` servers), compares it to the guard baseline for the project's language, and reports whether this user has accepted it. The trust record lives in `<ndx home>/trust/` with owner-only modes, never in the repository. `guardBaselineForLanguage` is now the single source of hench's default allowlists and blocked paths, and the baseline blocks credential files (`.env`, keys, `.npmrc`, `.netrc`, `.aws/`, `.ssh/`) for every language. `clampGuardToBaseline` narrows a guard to that baseline.
