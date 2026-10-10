# Keeping Your PRD Alive

Your PRD starts fresh and accurate. Three months later, finished work still sits open, requirements describe behaviour you changed last quarter, and findings from solved problems keep regenerating. This guide walks through keeping the PRD true as your codebase evolves.

The PRD is the product's requirements (the product layer: areas, capabilities, constraints) plus the changes being made to them (the change layer: changes, tasks, subtasks). See [The PRD](./concepts/). The two layers drift in different ways, and most of the requirements' drift is computed for you.

::: info v1 projects
Until the storage migration ships, `ndx init` creates v1 projects: one tree of epics, features, tasks and subtasks in `.rex/prd_tree/`, with no product layer. A v1 PRD has only work items, so all of its drift is the work drift below. [v1 projects](#v1-projects) at the end covers what is different.
:::

## What drifts

| Layer | Drift | How it shows |
|-------|-------|--------------|
| Product | The build broke a requirement | The capability reads **defective**: an open fix touches it, or one of its checks fails |
| Product | Someone edited a requirement and nothing is building the edit yet | The capability reads **revised**, and rex has drafted a change in the Inbox for it |
| Product | A requirement nobody wants any more | Still listed, reading *met* or *proposed*. Retire it with a change that removes it |
| Change | Work that shipped but was never closed | A change or task still open after its code merged |
| Change | Work that will never happen | A change still open after its idea was dropped |
| Change | Unplaced work | Changes waiting in the Inbox with `needsPlacement` |
| Findings | Solved problems keep coming back | `ndx recommend` re-proposes a finding you already fixed |

Status is computed, not set. A capability is *met* when its spec hash matches the one recorded when it was last built and its checks pass, so nobody marks a requirement done and nothing goes stale by being forgotten. Releases are a field on a change (`plannedRelease`, `shippedIn`), so there are no finished release containers to clear away either.

## Detecting drift

```sh
rex product show .        # every capability and constraint with status and health
rex health .              # tree rules, reader warnings and the landing check
ndx analyze .             # fresh codebase analysis
ndx recommend --actionable-only .
```

`rex product show` prints every area, capability and constraint with its status, adding *defective* when it is broken. The rows to look for are *revised* (the spec has moved ahead of the build) and *defective* (it is broken now); the dashboard's Product page will highlight them. `rex health` on a v2 PRD runs the tree rules and checks that completed changes landed; it exits non-zero on a rule error, so it also works as a CI gate.

From an assistant, the same views are the `get_product`, `get_capability` and `get_prd_status` MCP tools. `get_prd_status` reports the Inbox count.

## The maintenance loop

### 1. Empty the Inbox

Every new input lands as a change in the Inbox. A change that cannot be placed confidently waits with `needsPlacement`; autonomous runs skip it until someone places it.

```sh
rex change place <change> .                                   # the shortlist, best first
rex change place <change> --target=<node> --relation=touches . # it works on the capability
rex change place <change> --target=<node> --relation=amends \
  --capability-criterion="c3: A refund reaches the card" .    # it changes the requirement
```

A change that only *touches* a capability is a fix or a refactor: it writes nothing to the product layer and needs no steward. A change that *amends* one carries the new statement or capability criteria, and [apply](./concepts/changes-and-apply) writes them when it completes.

### 2. Close finished work, cancel dropped work

For each open change, ask whether its code has merged. If it has, close its remaining tasks; if the idea was dropped, cancel the change rather than leaving it open. A cancelled change no longer counts toward any capability's status.

The status commands (`rex update`, `update_task_status`, `ndx status`) and the dashboard's status editing read the v1 layout only: on a v2 PRD they stop with "Rex directory not found". Until they read v2, there is no command that closes or cancels a v2 change; this step applies to v1 projects (see [v1 projects](#v1-projects)).

### 3. Resolve the requirements that need attention

- **Revised** capabilities have a drafted change in the Inbox. Place it and schedule it, or edit the requirement back to its built spec, which withdraws the draft.
- **Defective** capabilities have an open fix or a failing check. Make sure a change touches each one and is on a planned release.
- **Unwanted** requirements are retired by a change that amends them with a *removed* delta. Applying it marks the node *retired*.

To change a requirement on purpose, edit it directly:

```sh
rex product edit <node> --statement="A shopper pays by card or wallet." .
rex product edit <node> --capability-criterion="c4: A wallet payment confirms in one step" .
rex product edit <node> --statement="A shopper pays by card." --editorial .   # wording only
```

Any edit except an `--editorial` one makes the capability read *revised* and drafts a change to build it. Capability criteria are the requirement's standing spec; they are not the acceptance criteria ("done when") of the change that builds it.

### 4. Re-analyze and acknowledge

```sh
ndx analyze .
ndx recommend --actionable-only .
ndx recommend --acknowledge .
```

Analysis surfaces new problems, and problems your recent work resolved. Accept the findings that matter as changes; acknowledge the ones you have fixed or have decided to live with, so they stop regenerating. Acknowledgments are kept in `acknowledged-findings.json` in rex's directory (`.rex/` on a v1 project), are gitignored as personal triage notes, and do not expire. See [Self-Heal Loop](./self-heal) for how acknowledged findings are matched.

### 5. Clean up the change layer

`ndx reshape`, `ndx reorganize` and `ndx prune` work on the change layer of a v2 PRD as they do on a v1 tree. They never write the product layer, which changes only through applied changes.

```sh
ndx reorganize .   # detect and propose structural fixes
ndx prune .        # remove completed work, keeping applied changes that added or removed a node
```

`prune`, `reshape` and `reorganize` record what they remove in `archive.json` in rex's directory (100 batches, auto-trimmed). It is an audit trail and a source for recovering an item by hand; no command restores from it.

### Example maintenance session

```sh
git checkout -b chore/prd-maintenance

rex product show .                         # what needs attention
rex health .
rex change place <change> --target=<node> --relation=touches .
ndx analyze .
ndx recommend --actionable-only .
ndx recommend --acknowledge .
ndx prune .

git add -A && git commit -m "PRD maintenance: placed inbox, closed shipped work"
```

## Recommended cadence

| When | What | Time |
|------|------|------|
| After each sprint | Empty the Inbox; close shipped work; cancel dropped work | 10–15 minutes |
| Monthly | The whole loop: Inbox, close, requirements, analyze and acknowledge, prune | 45–60 minutes |
| Before a release | `rex product show` has no unplanned *defective* rows; `rex health` passes | 5 minutes |

## Recovering from a mistake

The PRD is files in git, so git is the first recovery tool:

```sh
git diff -- .ndx/rex/              # see what changed (.rex/prd_tree/ on v1)
git checkout -- .ndx/rex/          # discard uncommitted PRD changes
git revert <commit-hash>           # undo a committed one
```

`ndx prd export` writes the whole PRD to a portable JSON bundle outside rex's directory, and `ndx prd import --replace` rebuilds it from one. Take a bundle before a large restructuring:

```sh
ndx prd export --out=./prd-backup.json .
# restore: ndx prd import --in=./prd-backup.json --replace --yes .
```

## v1 projects

A v1 PRD has no product layer, so there is no computed status to lean on: every item's status is set by hand or by a run, and drift shows only as items left open.

- **Detect** with `ndx status .` (the item tree) and `rex validate .` (orphaned items, parent-level mismatches, date anomalies). `ndx ci .` adds a health report with completion rate and item age.
- **Close** shipped work with `rex update <task-id> --status=completed --resolution-type=code-change`. The resolution types are `code-change`, `config-override`, `acknowledgment`, `deferred` and `unclassified`. Mark dropped work `deferred`, or remove it with `rex remove`.
- **Finished epics** stay in the tree until you remove them: `rex remove epic <epic-id>` removes an epic and everything under it. It does not write `archive.json`; recover with git.
- **Snapshots.** `ndx add` and `ndx reshape` copy `.rex/prd_tree/` to `.rex/.backups/` before they change it. `rex restore` lists the snapshots, and `rex restore --latest` or `rex restore --id=<snapshot>` rolls the whole tree back to one. It restores a snapshot, not a single item.
- **`ndx plan --accept`** adds proposals from a fresh analysis, deduplicated against the items already in the tree, and offers to enrich matching ones. It does not rewrite or archive the existing tree.

## Skills used in this guide

Each skill below is invoked during the maintenance cycles described in this guide. Edit the linked file in your project to customize that step's behavior in your assistant session.

| Skill | Source | Role in this guide |
|-------|--------|--------------------|
| `/ndx-status` | [`.agents/skills/ndx-status/SKILL.md`](./skills#ndx-status) | Detecting drift: PRD progress and codebase health in one report |
| `/ndx-plan` | [`.agents/skills/ndx-plan/SKILL.md`](./skills#ndx-plan) | Step 4: re-analyzes the codebase and proposes items for persistent or newly surfaced findings |
| `/ndx-reshape` | [`.agents/skills/ndx-reshape/SKILL.md`](./skills#ndx-reshape) | v1: restructures a drifted item tree — regroups epics, adjusts levels, merges overlapping items |
| `/ndx-capture` | [`.agents/skills/ndx-capture/SKILL.md`](./skills#ndx-capture) | Throughout: adds newly surfaced requirements to the PRD |

Related guides: [Workflow](./workflow) (the normal development loop this guide maintains), [Self-Heal Loop](./self-heal) (automates the analyze → recommend cycle between full maintenance passes), [Changes and apply](./concepts/changes-and-apply).

For the full skill inventory and customization guidance, see the [Skills Reference](./skills).
