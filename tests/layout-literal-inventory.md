# Layout-literal inventory

Every production source file that still spells out where n-dx keeps its files,
instead of asking the resolver.

**160 literals across 68 files.** That number is the debt, and it may only go
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
resolver and the migration command. PR B3 (#453) took the first cut — 193
sites down to 160 — but it routed **hench and web only**, where the task it
serves (`c64f053e`) reads "hench, web *and core*". Core was never in it, and
hench and web are not finished either. What is left:

| Package | Literals |
|---|---|
| core | 60 |
| web | 55 |
| hench | 25 |
| rex | 12 |
| llm-client | 6 |
| sourcevision | 2 |

So 140 of the remaining 160 sit in the three packages that sweep was meant to
clear. That is the number this file exists to keep honest: without it the task
reads as done because a PR with its name on it merged.

When the sweep really finishes, this file is deleted and the exemption table
above stands on its own — the rule as originally specified, with no change to
the detector.

---

## The debt

Counts are ceilings. A file may hold fewer than its number; it may not hold
more.


### core

| File | Literals | Names |
|---|---|---|
| `packages/core/ci.js` | 14 | .hench, .rex, .sourcevision |
| `packages/core/export.js` | 7 | .hench, .rex, .sourcevision |
| `packages/core/command-effects.js` | 6 | .rex, .sourcevision |
| `packages/core/pair-programming.js` | 6 | .n-dx*, .rex, .sourcevision |
| `packages/core/web.js` | 5 | .n-dx*, .rex |
| `packages/core/readme-generator.js` | 3 | .hench, .rex, .sourcevision |
| `packages/core/stale-check.js` | 3 | .hench, .rex, .sourcevision |
| `packages/core/claude-integration.js` | 2 | .hench, .n-dx* |
| `packages/core/config.js` | 2 | .hench, .rex |
| `packages/core/narration-status.js` | 2 | .sourcevision |
| `packages/core/refresh-validate.js` | 2 | .sourcevision |
| `packages/core/run-summary.js` | 2 | .rex, .sourcevision |
| `packages/core/sample-app.js` | 2 | .rex |
| `packages/core/assistant-assets.js` | 1 | .rex |
| `packages/core/cli.js` | 1 | .n-dx* |
| `packages/core/refresh-artifacts.js` | 1 | .sourcevision |
| `packages/core/self-heal-confirm.js` | 1 | .n-dx* |

### hench

| File | Literals | Names |
|---|---|---|
| `packages/hench/src/agent/lifecycle/shared.ts` | 6 | .n-dx*, .rex |
| `packages/hench/src/agent/lifecycle/uncommitted-work-gate.ts` | 4 | .rex |
| `packages/hench/src/agent/lifecycle/cli-loop.ts` | 2 | .hench, .rex |
| `packages/hench/src/validation/changed-files.ts` | 2 | .hench, .rex |
| `packages/hench/src/agent/analysis/adversarial-review.ts` | 1 | .rex |
| `packages/hench/src/agent/planning/cli-identity.ts` | 1 | .n-dx* |
| `packages/hench/src/cli/commands/config.ts` | 1 | .hench |
| `packages/hench/src/cli/commands/template.ts` | 1 | .hench |
| `packages/hench/src/cli/help.ts` | 1 | .hench |
| `packages/hench/src/quota/claude-quota.ts` | 1 | .n-dx* |
| `packages/hench/src/store/file-classifier.ts` | 1 | .rex |
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
| `packages/web/src/server/routes-hench.ts` | 12 | .hench, .rex |
| `packages/web/src/server/routes-adaptive.ts` | 6 | .hench |
| `packages/web/src/server/routes-workflow.ts` | 5 | .hench |
| `packages/web/src/viewer/views/files.ts` | 3 | .hench, .rex, .sourcevision |
| `packages/web/src/server/routes-config.ts` | 2 | .n-dx* |
| `packages/web/src/server/routes-llm.ts` | 2 | .n-dx* |
| `packages/web/src/server/routes-sourcevision-ask.ts` | 2 | .n-dx* |
| `packages/web/src/server/routes-worktrees.ts` | 2 | .n-dx* |
| `packages/web/src/viewer/views/llm-provider.ts` | 2 | .n-dx* |
| `packages/web/src/hub/children.ts` | 1 | .n-dx* |
| `packages/web/src/server/cli-name.ts` | 1 | .n-dx* |
| `packages/web/src/server/dashboard-usage.ts` | 1 | .n-dx* |
| `packages/web/src/server/merge-history.ts` | 1 | .rex |
| `packages/web/src/server/routes-cli-timeout.ts` | 1 | .n-dx* |
| `packages/web/src/server/routes-features.ts` | 1 | .n-dx* |
| `packages/web/src/server/routes-project-settings.ts` | 1 | .n-dx* |
| `packages/web/src/server/routes-sourcevision.ts` | 1 | .n-dx* |
| `packages/web/src/server/start.ts` | 1 | .n-dx* |
| `packages/web/src/server/task-usage/usage-cleanup-scheduler.ts` | 1 | .n-dx* |
| `packages/web/src/viewer/views/ask.ts` | 1 | .sourcevision |
| `packages/web/src/viewer/views/cli-timeout.ts` | 1 | .n-dx* |
| `packages/web/src/viewer/views/hench-config.ts` | 1 | .hench |
| `packages/web/src/viewer/views/hench-runs.ts` | 1 | .rex |
| `packages/web/src/viewer/views/hench-templates.ts` | 1 | .hench |
| `packages/web/src/viewer/views/iso-map.ts` | 1 | .sourcevision |
| `packages/web/src/viewer/views/notion-config.ts` | 1 | .rex |
| `packages/web/src/viewer/views/project-settings.ts` | 1 | .n-dx* |
| `packages/web/src/viewer/views/workflow-optimization.ts` | 1 | .hench |

### Registered ahead of merge

Files that gain their first literal from a branch still in review, registered
so the rule can merge at any point in the queue. A row here becomes an ordinary
row when its branch lands; if the branch is abandoned, delete it.

| File | Literals | Names | Arrives with |
|---|---|---|---|
| `packages/web/src/server/hench-config-fields.ts` | 1 | .hench | A7 |
