---
"@n-dx/llm-client": patch
---

Add `auth-token.ts`: `resolveAuthTokenPath`, `readAuthToken`, `ensureAuthToken` and `hasAuthToken` manage the per-user dashboard token file (`<ndx home>/auth.token`, created with owner-only modes) that the hub and project servers require.
