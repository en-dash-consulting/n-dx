# Public surface and freeze policy

The 0.9.0 release starts a **soft freeze** of the surfaces declared here.
Before 1.0.0, a change to one requires a release-note entry describing the
compatibility impact. From 1.0.0, a breaking change requires a **major
version**. A surface explicitly marked experimental remains changeable
until promoted; an exported symbol alone does not make it frozen.

## Declared surfaces

| Surface | Contract | Status |
|---------|----------|--------|
| PRD schema | `rex/v2`, product and change node types, intent/state separation, unknown-field preservation and version gates; [schema](./prd-folder-tree-schema) | Soft-frozen; frozen at 1.0.0 |
| MCP | Tool names, argument schemas and results for both servers listed below; stdio and Streamable HTTP transports | Soft-frozen; frozen at 1.0.0 |
| Bundle | `rex/prd-bundle` discriminator, envelope version and schema validation; v2 carries both layers with state apart | Soft-frozen; frozen at 1.0.0 |
| Directory layout | `.ndx/rex/`, `.ndx/hench/`, `.ndx/sourcevision/`, `.ndx/graview/`; legacy directories remain resolvable | Soft-frozen; frozen at 1.0.0 |
| Attribution | Final git trailer block with bare `N-DX-Item: <id>` and `N-DX` provenance | Soft-frozen; frozen at 1.0.0 |
| Rex TypeScript helpers | Library exports in `packages/rex/src/public.ts` beyond the schema contract | Outside this declared freeze |
| Extensions | `ndx.extension` manifest, process environment, `/x/<name>/` proxy, and the four versioned hub project/extension endpoints; [contract](./extensions) | Experimental until explicitly promoted |
| Graview projection and product face | Declaration, snapshot names, face and its feature flags | Outside this declared freeze; flags marked experimental stay experimental |

The package `./dist/*` export is an internal escape hatch with no stability
guarantee. The rex MCP tool `get_capabilities` reports available operations
and workspace binding; it is not a list of product capabilities.

## Rex MCP inventory

All tools below are declared for the freeze; none is individually marked
experimental. V2-only tools refuse a v1 tree with a layout error. The
registration order and complete schemas are pinned by
`packages/rex/tests/unit/cli/mcp-tools-list-snapshot.test.ts`.

| Tool | Contract |
|------|----------|
| `get_prd_status` | Layout-specific progress and product summary |
| `get_next_task` | Actionable work, respecting dependencies, placement and foreign claims |
| `update_task_status` | Transition work state, including completion and configured apply |
| `claim_task` | Hold a work unit for this worktree |
| `release_task` | Release that worktree's claim |
| `add_item` | Add v2 work by `type`, or v1 items by `level` |
| `edit_item` | Edit intent and saved execution settings |
| `move_item` | Reparent work under the layout's rules |
| `merge_items` | Consolidate compatible work items |
| `get_item` | Item context and parent chain |
| `append_log` | Structured execution-log entry |
| `get_recommendations` | Sourcevision-based recommendations |
| `verify_criteria` | Map acceptance criteria to tests; `runTests: false` avoids execution |
| `reorganize` | Detect or apply structural repairs |
| `health` | Structure health |
| `facets` | Configured facet distributions |
| `get_token_usage` | Per-item and descendant usage, plus orphans |
| `get_capabilities` | Server configuration, tool capabilities and workspace binding |
| `get_product` | V2 product areas and standing requirements |
| `get_capability` | V2 capability detail and derived status |
| `place_change` | V2 placement suggestions or chosen product target |
| `apply_change` | Apply v2 amendments under validation and the PRD lock |

## Sourcevision MCP inventory

All tools below are declared for the freeze; none is individually marked
experimental. Analysis quality is heuristic; freezing a result shape does
not promise that every detected zone, finding or readiness score stays the
same after an analysis improvement.

| Tool | Contract |
|------|----------|
| `get_overview` | Project analysis summary |
| `get_next_steps` | Prioritized analysis recommendations |
| `get_zone` | Zone structure and metrics |
| `get_findings` | Recorded findings |
| `get_file_info` | File inventory, classification and zone |
| `search_files` | Inventory search |
| `get_imports` | Import graph edges |
| `get_classifications` | File archetypes |
| `set_file_archetype` | Persist an archetype override |
| `get_route_tree` | Pages, API routes and layouts |
| `get_readiness` | Heuristic SDLC readiness scorecard and caveat |

## Bundle and paths

A v1 bundle uses `bundleVersion: 1` and `items`. A v2 tree exports
`bundleVersion: 2`, `schema: rex/v2`, `title`, `product`, `changes`, and
optional `header` and `folderState`; each node keeps tool fields under `state`.
Both carry `bundle: rex/prd-bundle`, `exportedAt` and optional provenance
`exportedFrom`. A v2 destination accepts a v1 bundle as change-layer work;
a v1 destination refuses a v2 bundle. Unsupported versions are refused
before writes. JSON bundles go outside the resolved rex directory and are
never a backend. Narrative Markdown is a lossy, one-way v1 export.

Resolve paths through the layout helpers: `.ndx/` layout and schema version
are separate choices. Existing `.rex/`, `.hench/` and `.sourcevision/`
projects keep working. On v2 only `product/` and `changes/` under the rex
directory hold PRD intent and state. Caches, logs and backups are not PRD
backends; see [generated files](./generated-files).

## Host-neutral review and merge requirements

Each task branch contains its implementation, meaningful regression tests,
patch changeset for affected scoped packages, and PRD state together.
Validation includes the affected checks and the required startup suites in
[TESTING.md](https://github.com/en-dash-consulting/n-dx/blob/main/TESTING.md).
Review findings must be resolved or explicitly accepted before merge.

Keep attribution in the final contiguous git trailer block, with nothing
after it:

```text
N-DX: skill/ndx-work
N-DX-Item: <bare-item-id>
Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
```

A squash or merge workflow must preserve the task's `N-DX-Item` trailer in
the commit that lands. A merge-request description is useful only when the
host carries it into that commit; the evidence reader uses git trailers,
not a GitHub API, a dashboard URL or text in the subject. For unrelated
multi-item changes, split the attribution or omit it rather than claiming
the whole diff for one item. These requirements apply on any git host.
