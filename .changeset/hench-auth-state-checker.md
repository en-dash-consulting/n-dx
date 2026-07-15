---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Detect authentication/session loss before it cascades. `@n-dx/llm-client` now exports `isAuthError(message)`, a shared predicate that recognizes both API auth failures (401/403, rejected/invalid keys, `unauthorized`) and CLI session loss (`not logged in`, `please run … login`, `/login`, expired/revoked sessions or OAuth tokens, `re-authenticate`). `classifyLLMError` uses it, so lost-session messages are now classified as `auth` with re-authentication guidance. In hench's CLI run-loop, `processErrorResult` checks for auth errors *before* the transient-retry check: auth loss is never transient, so the run now fails immediately with actionable re-auth guidance (and a distinct `auth_error` log event) instead of burning retries on a failure the user must fix.
