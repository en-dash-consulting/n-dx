# Layout-literal inventory

Every production source file that still spells out where n-dx keeps its files,
instead of asking the resolver.

**56 literals across 37 files.** That number is the debt, and it may only go
down.

## Why this file exists

Where n-dx keeps its state is one decision, and `resolveLayout` owns it:
`.ndx/rex` or `.rex`, `.ndx/config.json` or `.n-dx.json`, depending on which
layout the project is on. A literal `.rex/execution-log.jsonl` takes that
decision a second time, in a file that has no idea which layout it is running
under.

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
which is what `tests/e2e/layout-literal-policy.test.js` is for.

## The rule

The policy test scans each package's `src/` plus core's orchestration scripts,
blanks comments, and flags every **path-shaped** string literal naming `.rex`,
`.hench`, `.sourcevision` or one of the loose `.n-dx*` files. Then:

| Check | Fails when |
|---|---|
| Unlisted file | A file not in the tables below holds a literal. This is the one that matters: **new** literals cannot get in. |
| Grown file | A listed file holds more literals than its recorded count. |
| Stale row | A listed file holds none. Delete the row and lower the total. |

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
| `packages/rex/src/cli/commands/migrate-layout.ts`, `packages/core/migrate-layout.js` | The command whose whole purpose is moving a project between layouts. Listed ahead of its arrival so the rule needs no edit when it lands. |
| `packages/*/src/**/paths.ts` | A package's paths module answers the resolver's question for that package. |

## Clearing an entry

Replace the literal with the resolved path:

```js
import { resolveLayout } from "@n-dx/llm-client";
const { rexDir, henchDir, sourcevisionDir, configFile } = resolveLayout(root);
```

A package with a paths module (`rex`, `sourcevision`, `hench`, `web`) asks that
instead — it already composes the resolver with the package's own filenames.
Then lower the file's count, or delete its row when it reaches zero, and lower
the total at the top of this file.

## When this file goes away

The acceptance criterion behind the rule is absolute: *no* literal outside the
resolver and the migration command. Two cuts have landed:

- **PR B3 (#453)** took 193 sites to 160, but it routed **hench and web only**,
  where the task it serves (`c64f053e`) reads "hench, web *and core*".
- **PR 1 (`d31d9aa8`)** took 149 to 56: all of core, hench's git-bookkeeping
  classifiers, and the hench and web files that task enumerates.

What is left:

| Package | Literals |
|---|---|
| web | 29 |
| rex | 12 |
| hench | 7 |
| llm-client | 6 |
| sourcevision | 2 |

Two shapes account for nearly all of it, and neither was in PR 1's scope:

- **Project-config readers** that spell `.n-dx.json` / `.n-dx.local.json`
  instead of taking `configFile` from the resolver. They are spread across
  llm-client, hench, and web's routes, and they are the exact defect the second
  story at the top of this file describes.
- **Viewer copy and heuristics** — `files.ts` and the `views/*` rows — which
  name a directory in text shown to a person rather than to open it. Those need
  the resolved name threaded to the browser, or rewording; the hench-config
  view took the rewording route in PR 1 and is a worked example.

When the sweep really finishes, this file is deleted and the exemption table
above stands on its own — the rule as originally specified, with no change to
the detector.

## A note on the counts

These numbers are the detector's, and until PR 1 the detector could not see
through a glob. Its comment blanker read the `/*` inside `".hench/**"` as the
start of a block comment and blanked the rest of the file, so fourteen sites in
seven files — every `blockedPaths` entry in hench's guard defaults among them —
were silently exempt and the total read lower than the truth. PR 1 fixed the
blanker and cleared most of what it exposed; the two rows it exposed outside
that PR's scope, `packages/llm-client/src/repo-trust.ts` and
`packages/web/src/server/routes-token-usage.ts`, were fixed and recorded
respectively.

---

## The debt

Counts are ceilings. A file may hold fewer than its number; it may not hold
more.


### hench

| File | Literals | Names |
|---|---|---|
| `packages/hench/src/agent/analysis/adversarial-review.ts` | 1 | .rex |
| `packages/hench/src/agent/planning/cli-identity.ts` | 1 | .n-dx* |
| `packages/hench/src/quota/claude-quota.ts` | 1 | .n-dx* |
| `packages/hench/src/store/run-archiver.ts` | 1 | .n-dx* |
| `packages/hench/src/store/run-retention-scheduler.ts` | 1 | .n-dx* |
| `packages/hench/src/store/run-retention.ts` | 1 | .n-dx* |
| `packages/hench/src/tools/test-command-resolver.ts` | 1 | .n-dx* |

### llm-client

| File | Literals | Names |
|---|---|---|
| `packages/llm-client/src/config.ts` | 2 | .n-dx* |
| `packages/llm-client/src/llm-config.ts` | 2 | .n-dx* |
| `packages/llm-client/src/project-config.ts` | 2 | .n-dx* |

### rex

| File | Literals | Names |
|---|---|---|
| `packages/rex/src/analyze/scanners.ts` | 9 | .sourcevision |
| `packages/rex/src/cli/commands/status-sections.ts` | 2 | .rex |
| `packages/rex/src/store/prd-md-migration.ts` | 1 | .rex |

### sourcevision

| File | Literals | Names |
|---|---|---|
| `packages/sourcevision/src/cli/commands/prd-epic-resolver.ts` | 1 | .rex |
| `packages/sourcevision/src/cli/help.ts` | 1 | .sourcevision |

### web

| File | Literals | Names |
|---|---|---|
| `packages/web/src/viewer/views/files.ts` | 3 | .hench, .rex, .sourcevision |
| `packages/web/src/server/routes-config.ts` | 2 | .n-dx* |
| `packages/web/src/server/routes-llm.ts` | 2 | .n-dx* |
| `packages/web/src/server/routes-sourcevision-ask.ts` | 2 | .n-dx* |
| `packages/web/src/server/routes-token-usage.ts` | 2 | .n-dx* |
| `packages/web/src/server/routes-worktrees.ts` | 2 | .n-dx* |
| `packages/web/src/hub/children.ts` | 1 | .n-dx* |
| `packages/web/src/server/cli-name.ts` | 1 | .n-dx* |
| `packages/web/src/server/dashboard-usage.ts` | 1 | .n-dx* |
| `packages/web/src/server/routes-cli-timeout.ts` | 1 | .n-dx* |
| `packages/web/src/server/routes-features.ts` | 1 | .n-dx* |
| `packages/web/src/server/routes-project-settings.ts` | 1 | .n-dx* |
| `packages/web/src/server/routes-sourcevision.ts` | 1 | .n-dx* |
| `packages/web/src/server/start.ts` | 1 | .n-dx* |
| `packages/web/src/server/task-usage/usage-cleanup-scheduler.ts` | 1 | .n-dx* |
| `packages/web/src/viewer/views/ask.ts` | 1 | .sourcevision |
| `packages/web/src/viewer/views/cli-timeout.ts` | 1 | .n-dx* |
| `packages/web/src/viewer/views/hench-runs.ts` | 1 | .rex |
| `packages/web/src/viewer/views/hench-templates.ts` | 1 | .hench |
| `packages/web/src/viewer/views/iso-map.ts` | 1 | .sourcevision |
| `packages/web/src/viewer/views/notion-config.ts` | 1 | .rex |
| `packages/web/src/viewer/views/workflow-optimization.ts` | 1 | .hench |
