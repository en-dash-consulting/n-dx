---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Resolves all 11 `pnpm audit` findings (4 high, 7 moderate). Raises the pnpm overrides for the transitive dependencies of `@modelcontextprotocol/sdk` to their patched releases: fast-uri 3.1.6 (four host-confusion and SSRF advisories), hono 4.13.5 (`toSSG()` path traversal, `parseBody()` memory exhaustion, query parsing past the URL fragment) and qs 6.16.0 (array-limit bypass, `isBuffer` DoS). Bumps vitest to 4.1.11 for the `@vitest/mocker` redirect-mock arbitrary file read.
