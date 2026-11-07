# Glossary

::: warning The v2 model
These terms belong to the v2 model. Its commands and MCP tools ship from 0.9.0, and `ndx init` creates v2 projects; a v1 project is one that has not yet run `ndx migrate` (see [v1 projects](../prd-storage#v1-projects)).
:::

Each term is shown with an example from n-dx's own PRD.

| Term | Means | n-dx example |
|------|-------|--------------|
| **Product layer** | The product's standing requirements: what the app must do, each with a computed build status. Shown on the Product page. Not the codebase map, which shows how the code is structured | The list of n-dx's areas and capabilities |
| **Area** | A durable part of the product, named for the job it serves. Areas do not nest | Execute work |
| **Capability** | One thing the product does: a one-sentence statement plus its capability criteria, the standing spec it is met against. May hold sub-capabilities one level deep | Execute work › Session strategy: "A forked task session edits like a fresh one" |
| **Constraint** | A rule that applies across capabilities, checked by a test | Architecture integrity (gateways, spawn-only), checked by `architecture-policy.test.js` |
| **Change** | A bounded piece of work that adds, modifies, removes or fixes capabilities. Ticket-shaped; its release is a field, not a folder | "Forked sessions recover from a read-only refusal" (#473): touches Session strategy, planned for 1.0.1 |
| **Task, subtask** | A task is one step `ndx work` runs to make its change true; a subtask is a step within a task. A task is always shown inside its change | "Tell the forked session that orientation is over", in "Forked sessions recover from a read-only refusal" |
| **Runs as one task** | What a change with no tasks reads. It is itself the unit of work: it shows Start, takes run settings and `ndx work --task=<id>` runs it whole. Add a task and it stops reading this | A small fix with no tasks added |
| **PRD edits** | The Sidecar card that proposes edits to the PRD: the changes, tasks and subtasks it would add or alter. Nothing is written until you accept it. Not a change: a change is one piece of work, and a card may hold several | A card listing two new tasks for "Forked sessions recover from a read-only refusal" |
| **Branch** | The git branch you have checked out. It is where a change's work lands and where its work set is recorded. The default branch is never a work-set branch | `feat/sidecar-fast-stack` |
| **Work set** | The tasks assigned to a branch, recorded on the branch as `delivery: { branch }` in `state.yaml`. Assigning a change assigns its open tasks, a change with no tasks counts as one task, and a task sits on at most one branch. The default branch has no work set. On a branch with a work set, `ndx work`, `rex next` and `get_next_task` pick only from it; `--any` picks outside it | `rex branch add CH-2` puts CH-2's open tasks on this branch |
| **Track** | One group of ready tasks that can run side by side, as listed by `ndx work --plan-queue` and on Live's Ready next. Each track names its change and has its own Start track command | Track 1 · change "Forked sessions recover from a read-only refusal" |
| **Apply** | The step that writes a change's amendments into the product layer when it completes. Deterministic; no model is called | A change that modifies a Session strategy capability criterion completes; apply rewrites it, restamps the spec hash and adds a History line. (A touches-only fix such as #473 is never applied: its history and health are computed) |
| **Evidence** | What machines record as work happens | Commits with `N-DX-Item` trailers, hench run records, test results |
| **Status** | Where a capability stands against intent (see below). Computed | Session strategy reads *changing* while an amendment to it is unapplied |
| **Health** | Whether it is broken right now: *ok* or *defective*. Computed | Session strategy reads *defective* while #473 is open |

## Status and health

Nobody sets either by hand. Both are computed from files and state.

| Axis | Value | Rule |
|------|-------|------|
| Intent | Proposed | Created by an open change; never built |
| Intent | Changing | An amendment to it is unapplied: its change is open, or completed and awaiting review or release apply. Cancelled changes do not count |
| Intent | Met | The spec hash equals the hash recorded when it was last built, and its checks pass |
| Intent | Revised | The spec was edited after it was built, and no open change is building the edit |
| Intent | Retired | A removed delta was applied |
| Health | OK | Nothing below |
| Health | Defective | An open fix touches it, or one of its checks fails |

**Revised** is the signal a task board cannot show: the requirement has moved ahead of the build. The spec hash covers only the statement and capability criteria (never a change's acceptance criteria), so editing a capability's prose body never changes its status. Constraints carry health too.

## Relationships

- **Amends**: a change names a capability or constraint and a delta: *added*, *modified* or *removed*.
- **Touches**: a change names a node with no delta. Used for fixes and refactors.
- **Applies to**: a constraint names all capabilities, or a list of areas and capabilities.
- **Realized by**: which files and zones a capability lives in. Computed from the commits of changes that amended it, never written by hand.

## A change's kind is read, not tagged

| Relationship to the product layer | Kind |
|-----------------------------------|------|
| Amends, added | Feature (a kind of change, not a v1 level) |
| Amends, modified | Enhancement |
| Amends, removed | Retirement |
| Touches a defective capability | Fix |
| Touches, no status change | Refactor |
| Amends a constraint | Policy change |
| Neither, spike flag set | Spike |

Reclassifying is free: a "bug" that turns out to be a feature request gains an amendment, and its kind follows.

Back to [the PRD](./) · [Skills Reference](../skills)
