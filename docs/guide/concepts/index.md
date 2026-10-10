# The PRD: product layer and change layer

::: warning Ships with 1.0.0
This section describes the 1.0.0 model, which is still landing. Until the storage migration ships, `ndx init` creates **v1** projects: one tree of items in `.rex/prd_tree/`, with no product layer (see [PRD Storage Layout](../prd-storage#v1-projects)). Pages here say so where behaviour depends on 1.0.0.
:::

From 1.0.0 the **PRD is the product's requirements plus the changes being made to them**. It has two layers, and a third kind of record sits beside them.

| Layer | Holds | Written by | Lives in |
|-------|-------|------------|----------|
| **Product layer** | Areas, capabilities, constraints: the standing requirements, each with a computed build status | Stewards, and completed changes | `.ndx/rex/product/` |
| **Change layer** | Changes, and their tasks and subtasks: bounded work that closes | Stewards, engineers, `ndx add`, `ndx plan`, agents | `.ndx/rex/changes/` |
| **Evidence** | Commits with `N-DX-Item` trailers, hench run records, test results | Git, hench, CI | Git and `.ndx/hench/runs/` |

Every change names the parts of the product layer it affects. When the change completes, [apply](./changes-and-apply) updates the product layer to match.

## A living PRD, not a state document

The product layer holds *requirements*, not a description of the code. A requirement the build does not meet yet stays in it, marked **proposed** or **revised**. The forward-looking part of a classic PRD lives on changes, as proposed requirement text that merges in when the work lands.

Describing how the code is structured is a different job. That belongs to SourceVision's codebase map (zones, imports, files). "Map" in these docs only ever means the codebase map; the PRD is never called one.

## Why two layers

The old PRD was one tree for two different things. A requirement describes the product and is revised in place; it is never done. A change is a bounded piece of work that belongs to a release and closes. With a single kind of container, the release became the container, and the PRD read as a log of what was done rather than what the product is.

Splitting them gives each the right shape:

- **Releases are a field on a change** (`plannedRelease`, and `shippedIn` once released), never a folder. Views group by release; the product layer never mentions one.
- **A task's brief** carries the capability it changes, the rules that bind it, and where it lives in code. It no longer carries a release title.
- **Status is computed.** Nobody sets a capability to "done".

## Where to go next

- [Glossary](./glossary): the terms, each with a real n-dx example.
- [Changes and apply](./changes-and-apply): how a request becomes a change, and how it updates the requirements.
- [Bugs and hotfixes](./bugs-and-hotfixes): fixes touch a capability without amending it.
- [Stewards](./stewards): who approves changes to the requirements.

See also the [Skills Reference](../skills) for the assistant skills (such as `/ndx-capture`) that create changes.
