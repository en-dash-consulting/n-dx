## rex-satellite zone policy

Both `chunked-review` and `prd-fix-command` are satellite zones of `rex-cli` with cohesion 0.25 and coupling 0.75 (dual-fragility zones per the root `CLAUDE.md`'s "Monorepo-wide zone fragility governance" thresholds). In addition to the universal governance rules there:

- **CLI-only content:** These zones must contain only CLI command handlers and their direct support modules. Domain logic belongs in `rex-prd-engine` (e.g., `src/core/`).
- **Subdirectory convention:** Satellite zone files should be grouped into subdirectories under `packages/rex/src/cli/commands/` to make zone boundaries visible in the file tree.
