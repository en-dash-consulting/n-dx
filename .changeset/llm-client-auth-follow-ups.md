---
"@n-dx/llm-client": patch
---

A wrong Gemini API key is now an authentication failure. Google answers a bad key with HTTP 400 (not 401) and a body carrying the `API_KEY_INVALID` reason; the Google provider routed only 401 and 403 to the auth classifier, so a mistyped `GEMINI_API_KEY` surfaced as a generic failure. `complete()`, `stream()` and `generateContentWithTools()` now throw an `AuthFailureError` with the re-authentication guidance for that 400, `validateAuth()` answers `false` for it, and the shared auth signature recognises `API_KEY_INVALID`, so hench's auth halt sees it too. A 400 that does not name the key is still a non-auth failure.

`AuthFailureError.authReason` for a plain-text auth error is now a normalized reason — `invalid API key`, `token expired`, `not logged in`, `401 Unauthorized`, `403 Forbidden`, `unauthorized` or `authentication failed` — instead of the raw message echoed back; the provider detail is taken as the reason only when it was built from a JSON error body, where the extracted `error.message` is kept as before. The user-facing `message` is unchanged.
