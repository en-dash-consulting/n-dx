# Stewards

::: warning Ships with 1.0.0
This page describes the 1.0.0 model, which is still landing. `ndx init` creates v1 projects (`.rex/prd_tree/`) until the storage migration ships; a v1 PRD has no product layer and so no stewards.
:::

A steward directs the product by adding, enhancing or removing capabilities. Stewards are declared in the product layer itself and enforced through the host's code-owner file, so one person, a group, or a team with per-area ownership all use the same mechanism.

## Declaration

A `stewards:` list in the root `product/index.md` sets the default for the whole product. An area's `index.md` may override it. Entries are git emails, which every host understands; GitHub or Bitbucket handles and groups can be added as per-host aliases. The list is intent, so changing it is reviewed like any other edit.

| Shape | Declared as |
|-------|-------------|
| One steward | One entry on the root |
| A group | Several entries on the root; any one may approve |
| A team with ownership | Different entries per area |

For n-dx itself, Ryan is the root steward at the cut; per-area stewards are assigned during the area review.

## Enforcement

In the default `complete` [apply](./changes-and-apply) mode, apply runs on the branch, so every amendment appears in the PR as edits under `.ndx/rex/product/<area>/`. With `review` the apply may land in a later PR, and with `release` it waits for publication; the change PR then carries no product-layer edits and a `product/` code-owner rule does not gate it. Steward review happens in the PR that carries the apply. `rex codeowners` writes the host's code-owner file from the stewards lists (`CODEOWNERS` on GitHub, `.bitbucket/CODEOWNERS` on Bitbucket). It is opt-in (`"codeOwners": true` in rex's `config.json`) and leaves a file alone when it already matches, so it is safe to re-run after every stewards edit.

Where the host enforces code-owner approval (GitHub branch protection; Bitbucket Premium merge checks or a code-owners app), a steward must approve. Elsewhere, stewards are suggested reviewers.

## What needs a steward

- Amendments, including changes drafted from direct edits to the product layer
- Constraint changes
- Changes to the area list
- Apply, when `rex.applyOn` is `review`

## What does not

Fixes and refactors. A touches-only change writes nothing under `product/`, so no code-owner rule fires. See [Bugs and hotfixes](./bugs-and-hotfixes).

Back to [the PRD](./) · [Skills Reference](../skills)
