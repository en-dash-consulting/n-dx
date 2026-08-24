## rex-satellite zone policy

`rex-cli` (170 files, cohesion 0.99 / coupling 0.01 as of the 2026-08-24 `ndx analyze --deep` run on `main`) has two small satellite zones split out of it by Louvain:

| Zone | Files | Cohesion | Coupling | Contents |
|------|------:|---------:|---------:|----------|
| `chunked` | 5 | 0.67 | 0.33 | `cli/commands/chunked-review{,-state,-types}.ts` and support |
| `rex-fix` | 4 | 0.57 | 0.43 | `cli/commands/fix.ts` + `src/fix/{index,tree,types}.ts` |

Earlier revisions of this file called these `chunked-review` and `prd-fix-command` and recorded cohesion 0.25 / coupling 0.75 for both, describing them as dual-fragility zones. Neither currently meets that threshold (coupling is well under 0.5), and `rex-cli` itself is highly cohesive rather than fragile. Zone IDs and metrics are Louvain outputs — re-run `ndx analyze --deep .` and read `.sourcevision/zones.json` instead of trusting the numbers above.

The policies below are directory policies and apply regardless of which zone IDs the current analysis emits:

- **CLI-only content:** These directories must contain only CLI command handlers and their direct support modules. Domain logic belongs in `src/core/`.
- **Subdirectory convention:** Satellite files should be grouped into subdirectories under `packages/rex/src/cli/commands/` to make boundaries visible in the file tree. `commands/` is still a flat directory of 40+ files, so this remains a target rather than a description — see `packages/rex/src/cli/commands/ZONE_BOUNDARY.md`.
