# Layout-literal inventory

Every production source file that still spells out where n-dx keeps its config
files, instead of asking the resolver.

**29 literals across 22 files, all of them `.n-dx*`.** That number is the debt,
and it may only go down.

The three tool directories — `.rex/`, `.hench/`, `.sourcevision/` — are no
longer on this list. They are a **wall**: `tests/e2e/layout-literal-policy.test.js`
fails on any site outside its `ALLOWED` list, and there is nowhere to register
a new one. This file covers only what is left.

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

Both were caught by a human reading a diff. That is not a repeatable control,
which is what the policy test is for.

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

## Clearing an entry

Replace the literal with the resolved path:

```js
import { resolveLayout } from "@n-dx/llm-client";
const { configFile, localConfigFile } = resolveLayout(root);
```

A package with a paths module (`rex`, `sourcevision`, `hench`, `web`) asks that
instead — it already composes the resolver with the package's own filenames.
Then lower the file's count, or delete its row when it reaches zero, and lower
the total at the top of this file.

## When this file goes away

Three cuts have landed:

- **PR B3 (#453)** took 193 sites to 160, but it routed **hench and web only**,
  where the task it serves (`c64f053e`) reads "hench, web *and core*".
- **PR 1a (`d31d9aa8`)** took 149 to 53: all of core, hench's git-bookkeeping
  classifiers, and the hench and web files that task enumerates — plus the
  web side of the dashboard's port and pid markers (`server/start.ts`'s
  write, the Workspaces board and the hub's reads), which had to move in the
  same change as core's reads or the two would name different files.
- **PR 1b (`9a09a196`)** took 53 to 29 by clearing the last of the three tool
  directories, which is what turned that half into a wall: rex's sourcevision
  artifact attributions and its canonical PRD bucket key, sourcevision's PRD
  reader (in a helper nothing calls yet) and its static help text, hench's
  reviewer brief, and the eight viewer sites.

What is left is one shape: **project-config readers** that spell `.n-dx.json` /
`.n-dx.local.json` instead of taking `configFile` from the resolver. They are
spread across llm-client, hench, and web's routes, and they are the exact defect
the second story at the top of this file describes. Two web entries are not
config files but the dashboard's own markers (`.n-dx-web.port`,
`.n-dx-web-usage.jsonl`); they resolve the same way.

When that sweep finishes, this file is deleted, the two halves of the rule
collapse into one wall, and the exemption table above stands on its own.

## A note on the counts

These numbers are the detector's, and until PR 1a the detector could not see
through a glob. Its comment blanker read the `/*` inside `".hench/**"` as the
start of a block comment and blanked the rest of the file, so fourteen sites in
seven files — every `blockedPaths` entry in hench's guard defaults among them —
were silently exempt and the total read lower than the truth. PR 1a fixed the
blanker and cleared most of what it exposed.

---

## The debt

Counts are ceilings. A file may hold fewer than its number; it may not hold
more.

### hench

| File | Literals | Names |
|---|---|---|
| `packages/hench/src/agent/planning/cli-identity.ts` | 1 | .n-dx.json |
| `packages/hench/src/quota/claude-quota.ts` | 1 | .n-dx.json |
| `packages/hench/src/store/run-archiver.ts` | 1 | .n-dx.json |
| `packages/hench/src/store/run-retention-scheduler.ts` | 1 | .n-dx.json |
| `packages/hench/src/store/run-retention.ts` | 1 | .n-dx.json |
| `packages/hench/src/tools/test-command-resolver.ts` | 1 | .n-dx.json |

### llm-client

| File | Literals | Names |
|---|---|---|
| `packages/llm-client/src/config.ts` | 2 | .n-dx.json, .n-dx.local.json |
| `packages/llm-client/src/llm-config.ts` | 2 | .n-dx.json, .n-dx.local.json |
| `packages/llm-client/src/project-config.ts` | 2 | .n-dx.json, .n-dx.local.json |

### web

| File | Literals | Names |
|---|---|---|
| `packages/web/src/server/routes-config.ts` | 2 | .n-dx.json, .n-dx.local.json |
| `packages/web/src/server/routes-llm.ts` | 2 | .n-dx.json, .n-dx.local.json |
| `packages/web/src/server/routes-sourcevision-ask.ts` | 2 | .n-dx.json, .n-dx.local.json |
| `packages/web/src/server/routes-token-usage.ts` | 2 | .n-dx.json |
| `packages/web/src/server/cli-name.ts` | 1 | .n-dx.json |
| `packages/web/src/server/dashboard-usage.ts` | 1 | .n-dx-web-usage.jsonl |
| `packages/web/src/server/routes-cli-timeout.ts` | 1 | .n-dx.json |
| `packages/web/src/server/routes-features.ts` | 1 | .n-dx.json |
| `packages/web/src/server/routes-project-settings.ts` | 1 | .n-dx.json |
| `packages/web/src/server/routes-sourcevision.ts` | 1 | .n-dx.json |
| `packages/web/src/server/start.ts` | 1 | .n-dx-web.port |
| `packages/web/src/server/task-usage/usage-cleanup-scheduler.ts` | 1 | .n-dx.json |
| `packages/web/src/viewer/views/cli-timeout.ts` | 1 | .n-dx.json |
