---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Close every known dependency vulnerability ahead of the release.

`pnpm audit` reported two critical and three high advisories. One was reachable from shipped code: `@modelcontextprotocol/sdk` 1.30.0 (GHSA-6qxp-vccf-f47h, an OAuth client that could send credentials to an authorization server the MCP server chooses), a direct dependency of rex, sourcevision and web. It moves to 1.32.0.

The other four are transitive and are pinned with overrides in the same style as the existing ones: `proxy-addr` ≥ 2.0.8 (GHSA-jqcg-44mw-7w3h, IP spoofing — reached from shipped code through the MCP SDK's express), plus three that only ever load in development tooling — `shell-quote` ≥ 1.11.0 (GHSA-pqg4-j6r4-53mv, via `@changesets/cli`) and `vue` ≥ 3.5.42 with `source-map-js` ≥ 1.2.2 (GHSA-g2v6-rqmx-r4w6 and GHSA-68fv-2mgg-jv7q, both via vitepress's docs build).

`pnpm audit` now reports no known vulnerabilities.
