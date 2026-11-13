---
"@n-dx/web": patch
---

The dashboard's `Robot Wrangler` reuses credential verdicts for up to five minutes across visits, avoiding repeated vendor checks while tracked authentication inputs remain unchanged.

Checks observe effective vendor settings, the server's authentication environment, workspace trust records, and credential-store metadata when the API check depends on that store. Dashboard settings and trust changes invalidate only their workspace, including pending checks.

External CLI login, keychain state, helper output and provider-side revocation are not detected directly. Successful and failed verdicts expire five minutes after a check starts; use `Re-check` to check those external changes immediately. It bypasses completed verdicts while concurrent checks of the same context share work. Read-only tiles stop returning expired verdicts without launching a check. The auth subprocess timeout remains 60 seconds, separate from the cache lifetime.
