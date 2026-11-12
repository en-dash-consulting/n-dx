---
"@n-dx/web": patch
---

The dashboard's `Robot Wrangler` credential checks expire after one minute and refresh when tracked authentication inputs change.

Checks observe effective vendor settings, the server's authentication environment, workspace trust records, and credential-store metadata when the API check depends on that store. Dashboard settings and trust changes invalidate only their workspace, including pending checks.

External CLI login, keychain state, helper output and provider-side revocation are not detected directly. Verdicts expire one minute after a check starts; `Re-check` bypasses completed verdicts while concurrent checks of the same context share work. Read-only tiles stop returning expired verdicts without launching a check.
