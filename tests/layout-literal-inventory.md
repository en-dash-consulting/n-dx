# Layout-literal inventory

Every production source file that still spells out where n-dx keeps its config
files, instead of asking the resolver.

**0 literals.** The `.n-dx*` sweep landed with PR 29's "Route the remaining
.n-dx config readers through the resolver"; the table below is empty and may
not gain a row. Until the follow-up task turns the config half of
`tests/e2e/layout-literal-policy.test.js` into the same wall the directory half
already is, this file is what keeps it at zero: a file not listed here fails
the policy test the moment it names one of these paths.

The three tool directories — `.rex/`, `.hench/`, `.sourcevision/` — were
already a **wall**: `tests/e2e/layout-literal-policy.test.js` fails on any site
outside its `ALLOWED` list, and there is nowhere to register a new one.

## Why this file exists

Where n-dx keeps its state is one decision, and `resolveLayout` owns it:
`.ndx/rex` or `.rex`, `.ndx/config.json` or `.n-dx.json`, depending on which
layout the project is on. A literal `.n-dx.json` takes that decision a second
time, in a file that has no idea which layout it is running under.

What makes it worth a policy rather than a style note is how it fails. Nothing
throws. A `.ndx/` project gets a path nothing writes to, and whatever the
literal was reaching for is quietly skipped:

- `rex init` created `.ndx/rex/execution-log.jsonl` while adding only
  `.rex/execution-log*.jsonl` to `.gitignore`, so a generated log stayed
  trackable and got committed by accident.
- Every sourcevision reader of the project config guessed `.n-dx.json`, so risk
  justifications, zone types, the `language` and inventory overrides, archetype
  overrides, workspace members and the architecture declared for the iso map
  were all ignored on a new-layout project — and the analysis still succeeded,
  with different results and nothing to say why.
- The last 29 sites — llm-client's three config loaders, hench's CLI-name,
  weekly-budget, archival, retention and test-command readers, and fourteen
  files in web's server and viewer — read a root `.n-dx.json` on every layout,
  so a `.ndx/` project's dashboard saved CLI timeouts, feature flags and
  project settings to a file nothing else read, and its Ask ledger landed at
  the root instead of in `.ndx/`.

The first two were caught by a human reading a diff. That is not a repeatable
control, which is what the policy test is for.

## The rule

The policy test scans each package's `src/` plus core's orchestration scripts,
blanks comments, and flags every **path-shaped** string literal naming `.rex`,
`.hench`, `.sourcevision` or one of the loose `.n-dx*` files. It then splits
what it finds:

| Half | Check | Fails when |
|---|---|---|
| `.rex` `.hench` `.sourcevision` | Wall | Any site exists outside `ALLOWED`. |
| `.n-dx*` | Unlisted file | A file not in the table below holds one. **New** literals cannot get in. |
| `.n-dx*` | Grown file | A listed file holds more than its recorded count. |
| `.n-dx*` | Stale row | A listed file holds none. Delete the row and lower the total. |

Comments are blanked because a docstring naming `.rex/` is documentation, and
the files that explain the layout mention it most. Prose in string form
(`".hench/ already initialized, skipping"`) is not flagged either: it names a
folder without deciding where one lives, and flagging it would teach people to
add exemptions rather than read them.

The `.n-dx*` files are in scope even though the task that asked for this rule
names only the three directories. The resolver owns those paths too, and the
config-reader defect above was `.n-dx.json` — a rule that let it through would
not have caught the bug that prompted the rule.

## What is exempt, and why

`ALLOWED` in the policy test, plus every `src/**/paths.ts`:

| File | Why |
|---|---|
| `packages/llm-client/src/layout.ts` | The resolver. Naming the paths is its job. |
| `packages/core/layout.js` | The hand-written twin the orchestration tier needs, because it may not import a package. Pinned to the resolver by `tests/integration/layout-resolver-contract.test.js`. |
| `packages/llm-client/src/project-dirs.ts` | The single source of truth for the three directory names. |
| `packages/sourcevision/src/export/iso-{sources,declared}.ts` | `src/export/` bundles into the dependency-free standalone skill script and may import nothing but `node:` builtins, so it carries its own twins. Pinned by the same contract test. |
| `packages/web/src/viewer/state-paths.ts` | The viewer's twin. The viewer is a browser bundle and cannot import `layout.ts`, which reaches for `node:fs` at module scope. Pinned by the same contract test. |
| `packages/rex/src/cli/commands/migrate-layout.ts`, `packages/core/migrate-layout.js` | The command whose whole purpose is moving a project between layouts. Listed ahead of its arrival so the rule needs no edit when it lands. |
| `packages/rex/src/store/prd-md-migration.ts` | `LEGACY_SOURCE_FILE_PREFIX` — the `.rex/` prefix carried by `sourceFile` attributions already written by the flat `prd.md`/`prd.json` backends. A value in data on disk, not a path the process constructs; those backends only ever existed under `.rex/`. |
| `packages/*/src/**/paths.ts` | A package's paths module answers the resolver's question for that package. |

## Keeping it at zero

Ask the resolver instead of spelling a file name:

```js
import { resolveLayout } from "@n-dx/llm-client";
const { configFile, localConfigFile } = resolveLayout(root);
```

A package with a paths module (`rex`, `sourcevision`, `hench`, `web`) asks that
instead — it already composes the resolver with the package's own filenames.
Hench reaches the resolver through `src/prd/llm-gateway.ts`, as it does every
foundation-tier import. The viewer cannot reach it at all: a view that has to
*display* the file's name takes it from the server, which resolves it
(`GET /api/cli/timeouts` reports `configFile` for exactly this reason).

A public constant that has to keep its legacy name — `PORT_FILE` in web's
`start.ts`, `PROJECT_CONFIG_FILE` and `LOCAL_CONFIG_FILE` in llm-client — asks
the resolver for the legacy layout by name (`resolveLayout(".", { mode:
"legacy" })` touches no disk) rather than spelling the name a second time, and
is for labels only: no reader joins it to a root.

## How the count got here

- **PR B3 (#453)** took 193 sites to 160, routing hench and web.
- **PR 1a (`d31d9aa8`)** took 149 to 53: all of core, hench's git-bookkeeping
  classifiers, and the dashboard's port and pid markers.
- **PR 1b (`9a09a196`)** took 53 to 29 by clearing the last of the three tool
  directories, which turned that half into a wall.
- **PR 29** took 29 to 0: the project-config readers in llm-client, hench and
  web, the dashboard's usage ledger, and the one viewer site, which now shows
  the name the server resolves.

The counts were the detector's, and until PR 1a the detector could not see
through a glob: its comment blanker read the `/*` inside `".hench/**"` as the
start of a block comment and blanked the rest of the file, so fourteen sites in
seven files were silently exempt. PR 1a fixed the blanker.

---

## The debt

No rows. A `.n-dx*` literal in any production file fails
`tests/e2e/layout-literal-policy.test.js`; route it through the resolver rather
than adding a row here.
