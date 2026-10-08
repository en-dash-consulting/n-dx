# Layout-literal inventory

**No inventory.** There is nothing to register and no count to hold: every
path the layout owns is a wall, enforced by
`tests/e2e/layout-literal-policy.test.js`. A production file that spells out
`.rex/`, `.hench/`, `.sourcevision/` or one of the loose `.n-dx*` files fails
that test with its own file and line, and the only way to keep the literal is
to add the file to the test's `ALLOWED` list and say why.

This page is what is left of the register that got the tree there: why the
rule exists, how to comply with it, and how the sweep ran.

## Why the rule exists

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
blanks comments, and fails on every **path-shaped** string literal naming
`.rex`, `.hench`, `.sourcevision` or one of the loose `.n-dx*` files.

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

`ALLOWED` in the policy test is the list, with a reason beside each entry; it
is deliberately not copied here, because the copy in this file had already
gone stale by the time the sweep finished. Every entry is there for one of
four reasons:

- It **is** the resolver (`packages/llm-client/src/layout.ts`), or the single
  source of truth for the three directory names.
- It is a **twin** of the resolver, for a context that cannot import it — the
  orchestration tier, which may not import a package; the browser bundle,
  which cannot load a module that reaches for `node:fs`; and the standalone
  skill script, which may import nothing but `node:` builtins.
  `tests/integration/layout-resolver-contract.test.js` pins every twin to the
  resolver so they cannot drift apart.
- It is the **migration command**, whose whole purpose is moving a project
  between layouts.
- It carries a **legacy value already on disk** rather than a path the process
  constructs — the `.rex/` prefix on `sourceFile` attributions written by the
  flat `prd.md`/`prd.json` backends, which only ever existed under `.rex/`.

Every `src/**/paths.ts` is exempt by pattern: a package's paths module is where
that package composes the resolver with its own filenames.

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

## How the sweep ran

- **PR B3 (#453)** took 193 sites to 160, routing hench and web.
- **PR 1a (`d31d9aa8`)** took 149 to 53: all of core, hench's git-bookkeeping
  classifiers, and the dashboard's port and pid markers.
- **PR 1b (`9a09a196`)** took 53 to 29 by clearing the last of the three tool
  directories, which turned that half into a wall.
- **PR 29** took 29 to 0: the project-config readers in llm-client, hench and
  web, the dashboard's usage ledger, and the one viewer site, which now shows
  the name the server resolves. With the table empty, the `.n-dx*` half became
  a wall too and this file stopped being an input to the test — it holds no
  count, and the policy test no longer parses it.

The counts were the detector's, and until PR 1a the detector could not see
through a glob: its comment blanker read the `/*` inside `".hench/**"` as the
start of a block comment and blanked the rest of the file, so fourteen sites in
seven files were silently exempt. PR 1a fixed the blanker.
