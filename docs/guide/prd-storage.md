# PRD storage layout

The PRD is the product's requirements plus the changes being made to them: a
**product layer** (areas, capabilities, constraints) and a **change layer**
(changes, and their tasks and subtasks). [The PRD](./concepts/) explains the
model; this page explains how it sits on disk.

Both layers are plain Markdown in your repository, so diffs, blame and code
review work without custom tooling, and people, assistants, MCP clients and
the dashboard all read and write the same files.

::: info v1 projects
Until the storage migration ships, `ndx init` creates **v1** projects. A v1
PRD is one tree of items in `.rex/prd_tree/` with no product layer; it is
described under [v1 projects](#v1-projects) below. Rex reads the layout from
disk: `.ndx/rex/product/` present means v2, otherwise v1. The product-layer
commands (`rex product`, `rex change`) and MCP tools (`get_product`,
`get_capability`, `place_change`, `apply_change`) refuse a v1 PRD with a
message naming the layout.
:::

## The v2 layout

```
.ndx/rex/
├── product/
│   ├── index.md                   ← root header: title, schema, stewards
│   └── checkout/                  ← area
│       ├── index.md
│       ├── state.yaml             ← tool state for this folder's nodes
│       ├── pay-by-card.md         ← capability
│       └── refunds/               ← capability with sub-capabilities
│           ├── index.md
│           ├── state.yaml
│           └── partial-refunds.md
└── changes/
    └── refund-card-payments/      ← change: always a folder
        ├── index.md
        ├── state.yaml
        └── add-refund-endpoint.md ← task
```

A project still on the older `.rex/` directory layout keeps the same two
folders at `.rex/product/` and `.rex/changes/`.

### Intent in Markdown, state in `state.yaml`

Every node is stored in two places:

- **Intent**, what people write, is the node's Markdown file: YAML frontmatter
  (id, type, title, a capability's statement and capability criteria, a
  change's amendments and acceptance criteria, and so on) and a prose body.
- **State**, what tools write, is the folder's committed `state.yaml`, keyed
  by item id: status, timestamps, a capability's build stamps, a change's
  `appliedAt` and `shippedIn`. A node with no row reads as pending.

Keeping them apart means a status change never rewrites the file a person is
editing, and a merge conflict in state is resolved by item id (`rex
merge-state` is the git merge driver for it).

### Folders and files

- A **change** is always a folder (`<slug>/index.md`), so tasks can be added
  without moving it.
- Any other node is a folder only while it has children, and a `<slug>.md`
  file otherwise.
- There are no `## Children` tables: the directory tree is the structure.
- `product/index.md` is the root header. It carries the PRD title, the schema
  stamp, the slug rule and the default `stewards:` list.

### Frozen slugs

A node's folder or file name comes from its `slug` field, made from the title
when the node is created and never recomputed. Renaming a capability or a
change edits its title and leaves its path alone, so links and history stay
put.

### Display ids

Nodes carry short display ids alongside their UUIDs, such as `A1.1` for a
capability or `CH-2` for a change. Every command and MCP tool that takes a
node accepts its id, display id or alias.

### What you can rely on

- **One file per node**, at one path.
- **Byte-stable round trips.** Reading the tree and writing it back unchanged
  rewrites nothing; files are rewritten only when their content changes.
- **Writes under a lock.** Every write holds the PRD lock for the whole
  read-modify-write. A writer that cannot take it fails and names the holder.
- **Refused, not guessed.** A node whose frontmatter fails validation is
  skipped with a warning and never deleted by the next save.

### Editing by hand

Hand-editing intent is supported: keep `id`, `type` and `slug` intact.
Editing a capability's statement or capability criteria by hand has the same
effect as `rex product edit`: the capability reads *revised* until a change
builds the edit. Leave `state.yaml` to the tools. After an edit, run
`rex health` to check the tree.

## v1 projects

A v1 PRD lives in `.rex/prd_tree/`. Its items have a `level` (epic, feature,
task, subtask) instead of a layer and type, and there is no product layer.
The v2 reader reads a v1 tree as changes, tasks and subtasks: epics and
features read as changes.

The normative serializer and parser contract for this layout is
[PRD Folder-Tree Schema](../architecture/prd-folder-tree-schema).

### Folder per branch, file per leaf

An item with children is a slug-named folder holding `index.md`, which
carries the item's frontmatter and a `## Children` table. An item without
children is a bare `<slug>.md` file next to its siblings.

```
.rex/prd_tree/
├── auth/
│   ├── index.md
│   ├── login/
│   │   ├── index.md
│   │   └── validate-email.md
│   └── signup.md
└── dashboard.md
```

Slugs come from the title with an id suffix, and a v1 slug follows the title:
editing a title renames the folder or file. When a leaf gains its first child
it becomes a folder on the next save, and a folder whose last child is
removed collapses back to a file.

### Backups before mutation

`ndx reshape` and `ndx add` copy `.rex/prd_tree/` to
`.rex/.backups/prd_tree_<ISO>/` before changing it; the 10 newest snapshots
are kept. `rex restore` lists them, and `rex restore --latest` rolls back to
the newest. The same pass normalizes shapes older ndx versions wrote (bare
`<title>.md` files, `__parent*` fields, phantom `index-<hash>/` folders);
it leaves ambiguous files in place rather than guessing.

### Worked example: n-dx's own PRD

n-dx manages its own work with ndx, and this repository is still a v1
project, so its PRD is a live example of the v1 layout:

| Artifact | What it is |
|----------|-----------|
| [`prd.md`](https://github.com/en-dash-consulting/n-dx/blob/main/prd.md) | The hand-written product spec ndx started from: the input `ndx add --file=` and `ndx plan --file=` accept |
| [`.rex/prd_tree/`](https://github.com/en-dash-consulting/n-dx/tree/main/.rex/prd_tree) | The tree ndx manages: slug-named folders, YAML frontmatter, generated child tables |

## Working with the PRD

You rarely need to touch the files. Use the CLI, an assistant, or the
dashboard:

```sh
rex product show .    # v2: the product layer with status and health
ndx add "..." .       # a new change (v2) or smart-add proposal (v1)
ndx status .          # completion overview
ndx next .            # the next actionable task
ndx work .            # let the agent pick up the next task
```

From an assistant session the same operations are MCP tools (`get_product`,
`get_prd_status`, `get_next_task`, `add_item`, `place_change`, …) and the
`/ndx-capture`, `/ndx-plan`, `/ndx-work` and `/ndx-status` skills. See
[MCP Integration](./mcp) and the [Skills Reference](./skills).

## Related references

- The model: [The PRD](./concepts/) · [Changes and apply](./concepts/changes-and-apply)
- v1 schema: [PRD Folder-Tree Schema](../architecture/prd-folder-tree-schema)
- Concurrency: [PRD Write Concurrency](../architecture/prd-write-concurrency)
- Source: `packages/rex/src/store/prd-model-reader.ts` and `prd-model-writer.ts` (v2), `folder-tree-serializer.ts` and `folder-tree-parser.ts` (v1)
