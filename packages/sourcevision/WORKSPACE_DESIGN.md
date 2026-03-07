# Workspace Design: Multi-Repo Aggregation

Design specification for `sourcevision workspace` — aggregating multiple analyzed
repos into a unified architectural view. Part of the recursive zone architecture
epic; the fractal property from recursive subdivision makes workspace aggregation
a data-assembly problem rather than a re-analysis problem.

## Command Interface

### `sourcevision workspace [options] [root-dir]`

Single command, flag-driven behavior. Follows the existing sourcevision CLI
pattern where a command operates on a target directory (default `.`).

```
sourcevision workspace [root-dir]            # aggregate from config
sourcevision workspace --add <dir> [root-dir]    # add a member
sourcevision workspace --remove <dir> [root-dir] # remove a member
sourcevision workspace --status [root-dir]       # show members + freshness
```

The root directory is the *workspace root* — where the aggregated output lives.
Individual member repos are specified relative to this root. The workspace root
itself may or may not be a repo (it could be a bare directory containing only
`.sourcevision/` and `.n-dx.json`).

### Flags

| Flag | Description |
|------|-------------|
| `--add <dir>` | Add a directory as a workspace member (persists to config) |
| `--remove <dir>` | Remove a workspace member |
| `--status` | List members with analysis freshness, zone counts, file counts |
| `--fast` | Skip AI enrichment during cross-repo analysis |
| `--quiet, -q` | Suppress informational output |

### Examples

```sh
# Set up a workspace from a monorepo parent
sourcevision workspace --add packages/api --add packages/web .

# Run aggregation (reads members from config)
sourcevision workspace .

# Check workspace member status
sourcevision workspace --status .

# From n-dx orchestrator
ndx sourcevision workspace .
ndx sv workspace .
```

### n-dx orchestrator integration

No new top-level `ndx workspace` command. Access via tool delegation:
`ndx sourcevision workspace [args]` / `ndx sv workspace [args]`. This keeps the
orchestrator lean and avoids conflating workspace (analysis aggregation) with
other workspace concepts.

## Config Format

Workspace configuration lives in `.n-dx.json` under `sourcevision.workspace`.
This follows the existing pattern where sourcevision reads overrides from
`.n-dx.json` via `loadProjectOverrides()`.

### Schema

```json
{
  "sourcevision": {
    "workspace": {
      "members": [
        { "path": "packages/api", "name": "api" },
        { "path": "packages/web", "name": "web" },
        { "path": "../external-lib", "name": "external-lib" }
      ]
    }
  }
}
```

### `WorkspaceConfig` type

```typescript
/** Workspace configuration stored in .n-dx.json */
export interface WorkspaceMember {
  /** Path to the member repo, relative to workspace root. */
  path: string;
  /** Human-readable name (used as zone prefix). Defaults to directory basename. */
  name?: string;
}

export interface WorkspaceConfig {
  /** Workspace member repositories. */
  members: WorkspaceMember[];
}
```

### Rules

- `path` is always stored relative to the workspace root (the directory
  containing `.n-dx.json`). Absolute paths are resolved and stored as relative.
- `name` defaults to the last path segment (e.g., `packages/api` → `api`).
  Must be unique across members.
- Each member must have a `.sourcevision/manifest.json` — the workspace command
  does not run analysis on members; they must be pre-analyzed.
- Empty `members` array is valid (workspace with no repos yet).

### Auto-detection fallback

When no `sourcevision.workspace` config exists but the command is invoked, the
command falls back to `detectSubAnalyses()` (the existing behavior). This
preserves backward compatibility with monorepos that already have nested
`.sourcevision/` directories.

Priority: explicit config > auto-detection.

## Output Format

Workspace aggregation writes to `.sourcevision/` in the workspace root,
identical to a normal analysis. This is the key design decision: **workspace
output is indistinguishable from single-repo output**. Consumers (rex, MCP, web
dashboard) don't need workspace-specific code paths.

### Files produced

| File | Content |
|------|---------|
| `manifest.json` | Workspace manifest with `children[]` refs to member analyses |
| `zones.json` | Aggregated zones from all members + cross-repo crossings |
| `inventory.json` | Merged inventories (all member files with prefixed paths) |
| `imports.json` | Merged import graphs with cross-repo edges resolved |
| `CONTEXT.md` | Regenerated from aggregated data |
| `llms.txt` | Regenerated from aggregated data |

### Manifest extension

The existing `Manifest.children` field already supports this:

```json
{
  "schemaVersion": "1.0.0",
  "toolVersion": "0.1.0",
  "analyzedAt": "2026-03-03T...",
  "targetPath": "/path/to/workspace",
  "modules": {
    "inventory": { "status": "complete" },
    "imports": { "status": "complete" },
    "zones": { "status": "complete" }
  },
  "children": [
    { "id": "api", "prefix": "packages/api", "manifestPath": "packages/api/.sourcevision/manifest.json" },
    { "id": "web", "prefix": "packages/web", "manifestPath": "packages/web/.sourcevision/manifest.json" }
  ],
  "workspace": true
}
```

The `workspace: true` flag (new) distinguishes a workspace aggregation from a
normal analysis that happens to have sub-analyses.

### Zone ID namespacing

Promoted zones use the `{memberId}:{zoneId}` convention already established in
`promoteZones()`. For example, member `api` with zone `auth-module` becomes
`api:auth-module`.

## Schema Types

New types to add to `packages/sourcevision/src/schema/v1.ts`:

```typescript
// ── Workspace ────────────────────────────────────────────────────────────────

/** Workspace member configuration (stored in .n-dx.json). */
export interface WorkspaceMember {
  /** Path to the member directory, relative to workspace root. */
  path: string;
  /** Display name and zone prefix. Defaults to directory basename. */
  name?: string;
}

/** Workspace configuration block in .n-dx.json. */
export interface WorkspaceConfig {
  members: WorkspaceMember[];
}
```

Extend existing `Manifest`:

```typescript
export interface Manifest {
  // ... existing fields ...
  /** True when this analysis is a workspace aggregation (not a single repo). */
  workspace?: boolean;
}
```

## Implementation Plan

### Task 1: Workspace zone builder (`task-workspace-zone-builder`)

Build the aggregation engine that merges pre-analyzed repos into a unified
`.sourcevision/` output.

**Input**: List of `SubAnalysis` objects (from config or auto-detection).
**Output**: Aggregated `zones.json`, `inventory.json`, `imports.json`, updated
`manifest.json`.

Steps:
1. Add `WorkspaceMember` and `WorkspaceConfig` types to `schema/v1.ts`.
2. Add `workspace?: boolean` to `Manifest` interface.
3. Create `src/analyzers/workspace-aggregate.ts`:
   - `loadWorkspaceConfig(rootDir: string): WorkspaceConfig | null` — reads
     `.n-dx.json`, returns workspace config or null.
   - `resolveWorkspaceMembers(rootDir: string, config: WorkspaceConfig): SubAnalysis[]`
     — loads each member as a `SubAnalysis`, validates they have manifests.
   - `aggregateInventory(members: SubAnalysis[]): Inventory` — merge inventories
     with path prefixing.
   - `aggregateImports(members: SubAnalysis[]): Imports` — merge import graphs
     with path prefixing; external imports are preserved.
   - `aggregateZones(members: SubAnalysis[]): Zones` — promote all member zones
     via `promoteZones()`, merge crossings via `promoteCrossings()`.
   - `writeWorkspaceOutput(rootDir: string, members: SubAnalysis[]): void` —
     orchestrate the above and write all output files.
4. Create `src/cli/commands/workspace.ts`:
   - Parse `--add`, `--remove`, `--status` flags.
   - `--add`/`--remove`: mutate `.n-dx.json` workspace config.
   - `--status`: load config, check each member for `.sourcevision/manifest.json`,
     report freshness.
   - Default (no flags): run aggregation pipeline.
5. Register in `src/cli/index.ts` switch statement and `SV_COMMANDS` array.
6. Add help definition in `src/cli/help.ts`.

Acceptance criteria:
- `sourcevision workspace .` aggregates pre-analyzed member repos into a
  unified `.sourcevision/`.
- `sourcevision workspace --add <dir> .` persists to `.n-dx.json`.
- `sourcevision workspace --status .` shows member list with analysis dates.
- Output is valid — `sourcevision validate .` passes on workspace output.
- Falls back to `detectSubAnalyses()` when no explicit config exists.

### Task 2: Cross-repo crossing computation (`task-cross-repo-crossings`)

Resolve external imports between workspace members into actual cross-repo zone
crossings.

**Input**: Merged import graph where some "external" imports are actually
references to sibling members (e.g., `@api/utils` → `packages/api/src/utils`).
**Output**: Additional `ZoneCrossing[]` entries for imports that cross member
boundaries.

Steps:
1. Create `src/analyzers/workspace-crossings.ts`:
   - `buildPackageMap(members: SubAnalysis[]): Map<string, SubAnalysis>` — map
     package names to members (reads `package.json` from each member root).
   - `resolveExternalToMember(ext: ExternalImport, packageMap, members): ResolvedCrossing | null`
     — resolve an external import to a file in a sibling member.
   - `computeCrossRepoCrossings(members: SubAnalysis[], imports: Imports): ZoneCrossing[]`
     — iterate over external imports, resolve those that point to sibling members,
     look up the target file's zone, produce zone crossings.
2. Integrate into `workspace-aggregate.ts`:
   - After zone promotion, call `computeCrossRepoCrossings()`.
   - Append results to `zones.crossings`.
   - Report cross-repo crossing count in CLI output.
3. Handle common resolution patterns:
   - npm package name → member's `package.json` name field.
   - Monorepo workspace protocol (`workspace:*`) in package.json dependencies.
   - Path-based imports (`../../other-repo/src/foo`).

Acceptance criteria:
- External imports between sibling members appear as zone crossings in
  aggregated `zones.json`.
- Package name resolution works for both scoped (`@scope/pkg`) and unscoped
  packages.
- Workspace protocol dependencies are resolved.
- Cross-repo crossings include correct `fromZone` and `toZone` IDs using the
  `{memberId}:{zoneId}` namespace.
- A member with no resolvable cross-repo imports produces zero spurious
  crossings.

## Integration Points

### Existing code reuse

| Existing function | Used by workspace | Notes |
|---|---|---|
| `detectSubAnalyses()` | Auto-detection fallback | No changes needed |
| `loadSubAnalysis()` | Member loading | Wrap with config-driven path resolution |
| `promoteZones()` | Zone aggregation | No changes needed |
| `promoteCrossings()` | Intra-member crossing promotion | No changes needed |
| `buildSubAnalysisRefs()` | Manifest children | No changes needed |
| `getSubAnalyzedPrefixes()` | File filtering | No changes needed |
| `loadProjectOverrides()` | Config loading | Already supports arbitrary keys |
| `toCanonicalJSON()` | Output writing | No changes needed |

### MCP / web dashboard

No MCP changes required. The workspace output is standard `.sourcevision/`
format, so existing MCP tools (`sv_inventory`, `sv_zones`, etc.) work
automatically. The `children` field in the manifest already communicates the
workspace structure.

### Output generation

The existing output generation pipeline (`generateContextMd`, `generateLlmsTxt`)
reads from `zones.json`, `inventory.json`, etc. Since workspace aggregation
writes the same files in the same format, output generation works without
changes. Run it as a post-aggregation step.

## Edge Cases

1. **Member not analyzed**: Error with clear message suggesting
   `sourcevision analyze <member-dir>`.
2. **Stale member analysis**: `--status` reports `analyzedAt` timestamps.
   Aggregation proceeds with stale data (warns but doesn't block).
3. **Overlapping paths**: Two members whose paths share a prefix (e.g.,
   `packages/api` and `packages/api-v2`) — handled correctly because path
   matching is exact, not prefix-based.
4. **Circular cross-repo imports**: Legal (A imports B, B imports A). Treated the
   same as intra-repo circular imports — tracked as crossings, reported in
   findings.
5. **Missing package.json**: Member without `package.json` can't participate in
   package-name resolution but still contributes zones and inventory. Warn once.
6. **Workspace root is also a member**: Valid. The root's own files (outside
   member paths) become "root zones" alongside promoted member zones.
