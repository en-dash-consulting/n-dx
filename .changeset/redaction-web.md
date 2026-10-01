---
"@n-dx/web": patch
---

The dashboard scrubs credential-shaped text from run records as it serves them (covering records written before hench redacted at save time) and from the live analysis output it streams. The hub now spawns only `@n-dx/web`'s CLI entry point or an `ndx` launcher as a project server, refusing any other executable. The transitive `ip-address` dependency (via the MCP SDK's rate limiter) is pinned to a version without the published IPv6-classification advisories.
