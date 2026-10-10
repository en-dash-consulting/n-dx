# Changes and apply

::: warning Ships with 1.0.0
Commands and settings named here belong to the 1.0.0 model, which is still landing.
:::

## One door in

Every new input creates a **change**: `ndx add`, `/ndx-capture`, `ndx plan` proposals, SourceVision recommendations, an agent's follow-up during a run, and the dashboard's New button. Product nodes are created only by applying a change.

A change that cannot be placed confidently is held with `needsPlacement` until someone places it. It is not lost, and not guessed. `needsPlacement` only stops *autonomous* selection; `ndx work --task=<id>` can still run it.

## From request to requirements

A worked example from n-dx itself.

1. **Request.** Forked task sessions refuse to edit after a read-only refusal. It is reported as #473.
2. **Change.** "Forked sessions recover from a read-only refusal" is created. It *touches* the Session strategy capability (Execute work › Session strategy: "A forked task session edits like a fresh one") and carries `plannedRelease: 1.0.1`. Because it touches a capability without amending it, its kind reads as **Fix**, and Session strategy reads **defective**.
3. **Tasks.** The change is split into tasks, such as "Tell the forked session that orientation is over". `ndx work` runs them; hench records runs, and commits carry `N-DX-Item` trailers. That is the **evidence**.
4. **Merge.** #473 merges, Session strategy returns to **ok**, and its History gains a line. No container is left behind.
5. **Release.** When 1.0.1 publishes, the release pipeline stamps `shippedIn: 1.0.1` on the change.

A fix like #473 writes nothing under `product/`, so it never needs steward review. A change that *amends* a capability does.

## What apply does

Apply runs once per change, deterministically, with no model call. For each amendment:

| Delta | Writes |
|-------|--------|
| added | Creates the capability |
| modified | Adds, replaces or removes capability criteria by id |
| removed | Retires the node |

If the change carries a full proposed statement and capability criteria, written by the author or drafted with a model when the change was written and reviewed in the PR, apply writes that text instead. Each applied change appends a line to the capability's History and stamps the build hash.

A touches-only change writes nothing; its history and the capability's health are computed.

### When apply runs

The `rex.applyOn` setting chooses:

| Setting | The product layer on main changes when | For |
|---------|----------------------------------------|-----|
| `complete` (default) | The PR merges. Apply runs on the branch when the last task completes, so the update rides in the PR next to the code | Most teams |
| `review` | A steward approves the apply, in the same PR or a later one | Steward-gated teams |
| `release` | The release publishes | Teams where built means shipped |

In every mode, a completed but unapplied change keeps its capabilities reading *changing*.

## Editing requirements directly

Stewards may edit the product layer directly; that is how they say the requirement is now different.

- An edit marked **editorial** (typos, rewording, no behaviour change) re-stamps the spec hash and records a History line.
- Any other edit makes the capability read **revised**, and rex drafts a change in the Inbox to build it.

## Releases

A change carries `plannedRelease`; `shippedIn` is stamped when it ships (`rex release stamp <version>`, which the release pipeline runs). Release notes follow: group changes by `shippedIn`, then by kind.

## The commands

Each step above has a CLI command and an MCP tool. All of them work on a v2 PRD only and refuse a v1 one (`.rex/prd_tree/`).

| Step | CLI | MCP tool |
|------|-----|----------|
| See the product layer | `rex product show` | `get_product` |
| See one capability or constraint, with its changes | `rex product show <node>` | `get_capability` |
| Create a change (lands in the Inbox) | `ndx add "…"` or `rex add --title="…"` | `add_item` (type `change`) |
| Add a task or subtask to a change | `rex add task --title="…" --parent=<change>` | `add_item` (type `task` or `subtask`, `parentId`) |
| See where a change could go | `rex change place <change>` | `place_change` (no target) |
| Place it | `rex change place <change> --target=<node> --relation=touches\|amends` | `place_change` (with target) |
| Apply it as a steward | `rex change apply <change>` | `apply_change` |
| Edit a requirement directly | `rex product edit <node> --statement="…"` or `--capability-criterion="<id>: <text>"` | — |

Two flags look alike and mean different things. `--capability-criterion` edits a capability's capability criteria, its standing spec. `--criterion` on `rex add` sets a change's or task's acceptance criteria, its "done when".

Back to [the PRD](./) · [Glossary](./glossary) · [Skills Reference](../skills)
