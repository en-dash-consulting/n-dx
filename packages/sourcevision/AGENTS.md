## sourcevision language packs

sourcevision is a language-neutral engine. It reads language facts through
`@n-dx/lang-kit` and carries no parser runtime, grammar or query: those live
in `@n-dx/lang-runtime` and the `@n-dx/lang-*` packs.

### Rules

- **Packs are loaded, never imported.** Nothing in `src` imports
  `@n-dx/lang-runtime`, `web-tree-sitter` or a pack statically. The only
  references to a pack are the dynamic `import()`s in
  `src/language/pack-loader.ts` (`KNOWN_PACKS`). `tests/e2e/architecture-policy.test.js`
  enforces both.
- **Tests reach packs through the loader too.** `tests/helpers/workspace-pack.ts`
  loads a workspace pack and skips a test whose pack cannot run (grammar not
  built). The suite passes with no grammar built anywhere; tests that need a
  grammar and nothing of sourcevision belong in the pack's own suite.
- **Corpus and comparison scripts** (`scripts/`) import the workspace packs
  through `scripts/workspace-pack.mjs`, never the user's pack directory.

### How a pack is found, refused and degraded

`loadPack` (`src/language/pack-loader.ts`) never throws:

1. **Found** in the per-user pack directory first,
   `<ndx home>/packs/<sourcevision version>/node_modules/<package>` (where
   `npm install --prefix` puts opt-in packs), then by module resolution (the
   optional `@n-dx/lang-go` dependency, or the workspace).
2. **Refused** when its version differs from sourcevision's (checked from
   `package.json` before a pack-directory copy is imported, and again on the
   entry) or when it exports no matching lang-kit `LanguagePackEntry`. The
   notice names the `npm install --prefix … <package>@<version>` command.
3. **Degraded** when it is missing, refused, reports `degraded` (grammar not
   built or not loadable, a query that will not compile, unreadable build
   files) or its `analyzeProject` rejects. `src/analyzers/pack-imports.ts`
   reports it once per run: Java files get inventory only, Go edges come from
   the regex parser (`src/analyzers/go-imports.ts`). Analysis never fails on a
   pack.
