# PRD schema v2

This is the storage contract for `rex/v2`: a product layer of standing
requirements and a change layer of work. The executable shapes are in
`packages/rex/src/schema/v2.ts`, cross-node rules in `schema/v2-rules.ts`,
and disk behavior in `store/prd-model-reader.ts`, `prd-model-writer.ts` and
`state-writer.ts`. The older layout has its own
[v1 folder-tree contract](./prd-v1-folder-tree-schema).

## Roots and layout

Resolve the project's rex directory through the layout resolver. It is
`.ndx/rex/` on the current directory layout and `.rex/` on the legacy one;
schema version and directory layout are independent. This repository uses
`.rex/product/` and `.rex/changes/`.

```text
<rexDir>/
  product/
    index.md                   # root header
    checkout/
      index.md                 # area with children
      state.yaml               # state rows for nodes in this folder
      pay-by-card.md           # leaf capability
  changes/
    add-wallet/
      index.md                 # change, always a folder
      state.yaml
      wire-button.md           # leaf task
    inbox/
      investigate-wallet/
        index.md               # unplaced change
```

`product/` being present selects v2. A change is always a folder with an
`index.md`. Other nodes use folders while they have children and bare
`<slug>.md` files otherwise; subtasks are nodes, not sections embedded in a
task's body. Structure comes from directories, with no generated Children
tables. Changes nested inside another change remain changes.

The slug is frozen at creation. A title edit never recomputes it. A move
changes the parent path, preserving the slug and id. Clearing a change's
`needsPlacement` moves it from `changes/inbox/` to the change root. The Inbox
and root share a slug namespace. Slugs must be safe path segments, including
on Windows; sibling collisions are resolved by the serializer's slug rule.

## Root header and version gate

`product/index.md` carries YAML frontmatter with `schema: rex/v2`, the PRD
`title`, the slug-rule stamp (`slugRule`) and optional default `stewards`.
Every `state.yaml` also carries a schema stamp. Compatible v2 minor stamps
are readable; an incompatible or newer unsupported schema is refused for
writing. The writer checks the on-disk stamp again under the lock, so a
model loaded before another tool restamped the tree cannot overwrite it.

## Intent fields

Each node has YAML frontmatter plus a Markdown body. Shared intent fields
are `id`, `type`, `title`, `slug`, optional `displayId`, `aliases`, `tags`,
`source`, `blockedBy`, and reserved `hypotheses`. The id is the stable key;
commands and MCP tools also accept display ids and aliases.

| Type | Layer | Additional intent |
|------|-------|-------------------|
| `area` | product | `summary`, `stewards` |
| `capability` | product | `statement`, `criteria`, `requirements`, `dependsOn` |
| `constraint` | product | `statement`, `requirements`, `appliesTo` (`all` or product ids) |
| `change` | changes | `intent`, `acceptanceCriteria`, `amends`, `touches`, `plannedRelease`, `spike`, `fix`, `priority`, `requirements`, `discoveredFrom`, `run`, effort fields |
| `task` | changes | `description`, `acceptanceCriteria`, `requirements`, `priority`, `run`, effort fields |
| `subtask` | changes | `description`, `acceptanceCriteria` |

Capability criteria are `{ id, text }` objects: their stable criterion ids
are amendment targets. Acceptance criteria on changes, tasks and subtasks
are strings describing when that work is done. They never enter a product
node's spec hash. `level` is a v1 field, not a substitute for v2 `type`.

Effort fields are `loe` (positive engineer-weeks), `loeRationale`,
`loeConfidence` (`low`, `medium`, `high`) and reserved `effort`. A saved
`run` block holds portable execution settings, including a model tier and
optional per-vendor pins. Writers validate known settings; readers preserve
unknown object keys so older tools do not erase newer intent.

## State fields

Tools write state in the folder's committed `state.yaml`, keyed by node id:

```yaml
schema: rex/v2
items:
  c0000000-0000-4000-8000-000000000002:
    status: in_progress
    startedAt: "2026-10-27T12:00:00.000Z"
```

A missing row or status reads as `pending`. State is kept apart from intent:
a status-only change does not rewrite the node's Markdown.

| State | Fields |
|-------|--------|
| Execution | `status`, `startedAt`, `completedAt`, `endedAt`, `activeIntervals`, `failureReason`, `resolutionType`, `resolutionDetail` |
| Product evidence | `metAt`, `revisedAt`, `reviewedHash`, `checks` |
| Change evidence | `appliedAt`, `appliedAmendsHash`, `shippedIn`, `prs`, `issues` |
| Bookkeeping | `assignee`, `ready`, `needsPlacement`, `lastModified`, `lastModifiedBy`, reserved `links` |

The work statuses are `pending`, `in_progress`, `completed`, `failing`,
`deferred`, `blocked`, `cancelled` and `deleted`. Product status and health
are derived, not stored copies of these values. `metAt` and `reviewedHash`
are spec hashes, not timestamps; `revisedAt` is a timestamp. A spec hash
covers that node's own statement and capability criteria, not inherited
criteria or a change's acceptance criteria. Requirement checks record
`requirementId`, `result` (`pass`, `fail`, `skipped`), `at`, and optional
`detail` and `commit`. Tracker references are full HTTP(S) URLs or tracker
keys, not a host-specific shorthand such as `owner/repo#12`.

Unknown node keys, state-row keys and state-file top-level keys survive
round trips. Retired state fields stay state; they must not migrate into
intent merely because the running tool no longer uses them.

## Placement, amendments and completion

A change targets standing requirements through `touches` or `amends`. An
unplaced Inbox change is not selected by `ndx work`. A task belongs under a
change; a subtask belongs under a task. A change without tasks is itself a
work unit. A change containing nested changes is a container, not a unit
selection can run.

An amendment has `target`, `delta` (`added`, `modified`, `removed`) and
`summary`. Optional `criteria` carries `add`, `replace` and `remove` deltas;
`proposed` carries replacement text. An added amendment specifies `under`
and `title`, and may select `type: capability` or `type: constraint`.
`base` pins the target's spec hash; apply refuses a mismatch rather than
silently overwriting a revised spec. A fix cannot also be a spike or add or
remove a product node.

Completing work and applying its amendments are distinct operations.
`rex.applyOn` chooses automatic apply on completion or an explicit review
step. Apply stamps `appliedAt` and `appliedAmendsHash`; release stamping
records `shippedIn`. Commits and apply evidence are derived from final
`N-DX-Item` git trailers, not a stored SHA that would stale after a rebase.

## Write contract and recovery

Use `withPrdModelTransaction` or the resolved store's `withTransaction` for
the entire load, mutate and write span. The lock is per rex directory and
names its holder on refusal. Two worktrees have different locks and
independent PRDs; shared task claims prevent duplicate selection but do not
merge their state. See [PRD write concurrency](./prd-write-concurrency).

The writer validates before writing, uses atomic file writes, emits stable
frontmatter ordering and rewrites only changed content. An unchanged read
and write is byte-stable; CRLF-only differences do not force rewrites.
Invalid intent is warned about and skipped on read, then protected from
accidental deletion on save. Removing a node must be explicit. Non-tree
files and dotfiles are preserved. These are per-file atomic writes, not a
promise that a crash cannot interrupt a multi-file transaction.

Normal PRD writes stay inside `product/` and `changes/`. Config, logs,
locks, snapshots and derived caches are separate artifacts. An export
bundle is transport written outside the resolved rex directory; import
reconstructs the tree under its lock. Narrative export is one-way prose
and currently available for v1 only. Legacy migration commands are the
explicit exception that can read or create older representations; routine
mutations never create `prd.md`, `prd_*.md` or `prd.json`.

## Verification

- `packages/rex/tests/unit/store/prd-model-writer.test.ts`: byte stability,
  layout, preserved unknown data and deletion protection.
- `packages/rex/tests/integration/public-v2-runtime.test.ts`: selection,
  completion and transaction behavior through the public API.
- `packages/rex/tests/e2e/cli-prd-bundle-v2.test.ts`: transport round trips.
- `tests/e2e/architecture-policy.test.js`: executable v2 storage-root policy.
- `tests/e2e/instruction-alignment.test.js`: identical v2 invariant in every
  generated assistant surface.
