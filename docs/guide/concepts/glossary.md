# Glossary

::: warning Ships with 1.0.0
These terms belong to the 1.0.0 model, which is still landing.
:::

Each term is shown with an example from n-dx's own PRD.

| Term | Means | n-dx example |
|------|-------|--------------|
| **Product layer** | The product's standing requirements: what the app must do, each with a computed build status. Shown on the Product page. Not the codebase map, which shows how the code is structured | The list of n-dx's areas and capabilities |
| **Area** | A durable part of the product, named for the job it serves. Areas do not nest | Execute work |
| **Capability** | One thing the product does: a one-sentence statement plus acceptance criteria. May hold sub-capabilities one level deep | Execute work › Session strategy: "A forked task session edits like a fresh one" |
| **Constraint** | A rule that applies across capabilities, checked by a test | Architecture integrity (gateways, spawn-only), checked by `architecture-policy.test.js` |
| **Change** | A bounded piece of work that adds, modifies, removes or fixes capabilities. Ticket-shaped; its release is a field, not a folder | "Forked sessions recover from a read-only refusal" (#473): touches Session strategy, planned for 1.0.1 |
| **Task, subtask** | The steps of a change; what `ndx work` runs. A change with no tasks is itself the unit of work | "Tell the forked session that orientation is over" |
| **Apply** | The step that writes a change's amendments into the product layer when it completes. Deterministic; no model is called | A change that modifies a Session strategy criterion completes; apply rewrites the criterion, restamps the spec hash and adds a History line. (A touches-only fix such as #473 is never applied: its history and health are computed) |
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

**Revised** is the signal a task board cannot show: the requirement has moved ahead of the build. The spec hash covers only the statement and criteria, so editing a capability's prose body never changes its status. Constraints carry health too.

## Relationships

- **Amends**: a change names a capability or constraint and a delta: *added*, *modified* or *removed*.
- **Touches**: a change names a node with no delta. Used for fixes and refactors.
- **Applies to**: a constraint names all capabilities, or a list of areas and capabilities.
- **Realized by**: which files and zones a capability lives in. Computed from the commits of changes that amended it, never written by hand.

## A change's kind is read, not tagged

| Relationship to the product layer | Kind |
|-----------------------------------|------|
| Amends, added | Feature |
| Amends, modified | Enhancement |
| Amends, removed | Retirement |
| Touches a defective capability | Fix |
| Touches, no status change | Refactor |
| Amends a constraint | Policy change |
| Neither, spike flag set | Spike |

Reclassifying is free: a "bug" that turns out to be a feature request gains an amendment, and its kind follows.

Back to [the PRD](./) · [Skills Reference](../skills)
