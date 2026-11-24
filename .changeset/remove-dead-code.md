---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
"@n-dx/graview-face": patch
---

Internal: remove dead code without changing behaviour: empty placeholder modules, unused re-export barrels and shims, unexported helpers and exports nothing imported, and unused locals in the dashboard.

Removed `hench/src/tools/pr-status-trailers.ts`, `hench/src/process/exec-shell.ts`, `hench/src/types/index.ts`, `rex/src/core/compact-single-children.ts` and `sourcevision/src/analyzers/index.ts`; none had an importer. The `./dist/*` subpaths of those files no longer exist; that export is an internal escape hatch with no stability guarantee.
