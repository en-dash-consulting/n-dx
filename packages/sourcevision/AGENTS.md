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
   notice names `ndx sv pack add <lang>` (`packInstallCommand`).
3. **Degraded** when it is missing, refused, reports `degraded` (grammar not
   built or not loadable, a query that will not compile, unreadable build
   files) or its `analyzeProject` rejects. `src/analyzers/pack-imports.ts`
   reports it once per run: Java files get inventory only, Go edges come from
   the regex parser (`src/analyzers/go-imports.ts`). Analysis never fails on a
   pack.

### How packs are installed

`sv pack` (`src/cli/commands/pack.ts`, reached as `ndx sv pack …`) manages
the pack directory for every pack in `INSTALLABLE_PACKS` (java, go, sql,
terraform; only `KNOWN_PACKS` are analyzed with today):

- `add <lang>` runs `npm install --prefix <pack dir> @n-dx/lang-<lang>@<sourcevision version>`,
  creating the directory, then loads the pack from it with `loadPack`; a
  mismatch, a load failure or a pack npm did not put there is an error carrying
  npm's output. `--dry-run` prints the command.
- `list [--json]` reports each pack as installed (pack directory), resolved
  (module resolution), missing or refused, with its version.
- `remove <lang>` runs `npm uninstall --prefix`; a pack found only by module
  resolution is left alone.

Offline, for a machine with no registry access:

- `bundle <lang> [--out <file>]` (connected machine) runs the same npm install
  into a fresh temporary prefix, loads the pack from it, writes
  `n-dx-pack-bundle.json` (pack, package, version, sourcevision version,
  `platform: "any"`: grammars are WASM) and archives the whole prefix as one
  `.tgz`, default `n-dx-lang-<lang>-<version>.tgz`. The prefix is removed.
- `add <lang> --from <bundle>` makes no npm call. It reads the manifest first
  and refuses a bundle of another pack or version, or an archive that will not
  read; then replaces the pack's `node_modules` copy, records the pack in the
  pack directory's `package.json` and loads it as `add` does.

The archive is written and read in Node (`src/cli/commands/pack-archive.ts`),
not by a `tar` process: regular files and directories only, with pax long
paths; reading refuses links, bad checksums, truncation and any path that is
absolute or contains `..`.

npm runs through llm-client's `spawnCli` (cmd.exe on Windows, for npm's `.cmd`
shim). The runner, pack list, pack directory and importer are injectable; tests
(`tests/unit/cli/pack.test.ts`) use a fake npm and never the network.
