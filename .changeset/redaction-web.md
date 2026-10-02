---
"@n-dx/web": patch
---

The dashboard scrubs credential-shaped text from run records as it serves them (covering records written before hench redacted at save time) and from every command's output it shows — the live analysis stream, the output the full analysis leaves behind when it completes, and the quick analysis response, the last two of which previously overwrote or bypassed the scrub and surfaced raw stdout. The hub now spawns only `@n-dx/web`'s CLI entry point or an `ndx` launcher as a project server, refusing any other executable — and identifies that entry point by the owning package's `package.json` name rather than its path shape, so a file planted at a matching path is no longer accepted. The transitive `ip-address` dependency (via the MCP SDK's rate limiter) is pinned to a version without the published IPv6-classification advisories.
