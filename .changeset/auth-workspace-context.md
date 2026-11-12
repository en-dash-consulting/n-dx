---
"@n-dx/web": patch
---

The dashboard's `Robot Wrangler` credential checks keep each workspace's result separate, including when checks run concurrently.

Checks share work only when their workspace and effective vendor configuration match. Project-local configuration still takes precedence, and changing contexts no longer replaces another context's cached verdict.
