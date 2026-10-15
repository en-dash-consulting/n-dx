# Gateway Modules

When a package imports from another package at runtime, all imports are concentrated into a single **gateway module**. This makes the cross-package dependency surface explicit, auditable, and easy to update.

## Current Gateways

| Package | Gateway file | Imports from | Purpose |
|---------|-------------|--------------|---------|
| hench | `src/prd/rex-gateway.ts` | rex | Store access, tree traversal, task selection, timestamps, auto-completion, finding acknowledgment, and the v2 surfaces: layout and store detection (`prdLayout`, `isChangeLayerStore`), selection (`findNextWorkTask`, `findActionableWork`, `resolveWorkById`, `openChangeTasks`: the open tasks a `--task` on a change is refused naming when none can run), the brief (`buildChangeBrief`), completion (`completeV2Work`), tree bookkeeping (`isAppliedChange`, `indexTree`, `enclosingChangeIds`, type `V2Tree`) and the reader (`loadPrdModel`: which untracked intent files beside a completion's `state.yaml` hold rows there). Export ceiling enforced by `tests/e2e/architecture-policy.test.js`: 67 |
| hench | `src/prd/llm-gateway.ts` | @n-dx/llm-client | Config, constants, JSON parsing, output formatting, process execution, token parsing, model resolution |
| web | `src/server/rex-gateway.ts` | rex | Rex MCP server factory, domain types & constants, tree utilities, PRD backup snapshots and `V2RestoreRefusedError` (the restore routes answer 409 `V2_RESTORE_REFUSED` on a v2 tree), and the v2 merge rule (`validateChangesMerge`, `mergeChanges`, `ChangesMergeOutcome`: the merge route, refinement merge and reorganize apply on a v2 tree), and the v2 model and product reports (`loadPrdModel`, `productReport`, `capabilityReport`, `indexTree`, `isOpenChange`, `isAppliedChange`, `specHash`, `nodeSpec` and the `V2Tree`, `RuleNode`, `ChangeNode`, `TreeIndex` types: the Product, Changes and capability views); export ceiling 99 — raised from 87 to 99 for the v2 product reads, the project settings rex owns (`rex.applyOn`, `rex.placement.autoAccept`: accepted values, defaults and parsers); export ceiling 102 |
| web | `src/server/domain-gateway.ts` | sourcevision | Sourcevision MCP server factory, next-step derivation, archetype override, iso-map builder, analysis artifact schema types, live analyze progress reader, analyze command-line check, cross-repo artifact types (repo identity, outbound, infrastructure) |
| web | `src/viewer/external.ts` | messaging, shared, schema | Viewer-to-server boundary gateway |

## Rules

1. **One gateway per source package** — all runtime imports from a given upstream package pass through a single gateway. A consumer may have multiple gateways for different upstream packages.

2. **Re-export only** — gateways re-export; they contain no logic. Enforced by `domain-isolation.test.js`.

3. **Type imports through gateway** — `import type` must also flow through gateways to prevent type-import promotion erosion (a type import can be silently promoted to a runtime import during refactoring). Exception: web viewer files are exempt because the server/viewer boundary prevents them from reaching the server-side gateway.

4. **Messaging exemption** — `src/viewer/messaging/` files may import directly from `src/shared/` without going through `external.ts`. Enforced by `boundary-check.test.ts`.

5. **New cross-package imports** require a deliberate edit to the gateway, not a casual import in a leaf file.

## Intra-Package Gateways

Within the web package, `src/viewer/external.ts` concentrates all viewer-side imports from `src/viewer/messaging/`, `src/shared/`, and `src/schema/`. `RequestDedup` is canonically located in `src/viewer/messaging/request-dedup.ts` and re-exported through `external.ts` for viewer consumers.

## Rex v2 runtime surface

`packages/rex/src/public.ts` exports the v2 (product/change layer) surface in two blocks. #648 (on main) added the model: reader, tree types, index and the derived product computations. The selection-and-completion PR adds the runtime the MCP tools and CLI call: transaction, selection, completion, brief and `ChangeLayerStore`. hench's and web's rex gateways re-export the parts they need (roadmap PRs 35 and 36, stacked on this one), so consumers never import rex internals.

**A name is exported from `public.ts` once.** A second `export { X }` of a name is TS2300 "Duplicate identifier", so identical names on two branches do not merge cleanly: the restack onto #648 had to delete this PR's duplicate re-exports of `prdLayout`, `loadPrdModel`, `PrdModel`, `LoadPrdModelOptions`, `V2Tree` and `RuleNode`. Grep `public.ts` before adding a name.

| Concern | Exports |
|---------|---------|
| Reader (#648) | `loadPrdModel`, `prdLayout`, `V1_LEVEL_TYPES`, `NEWEST_SCHEMA`, `SchemaSkewError`; types `PrdModel`, `LoadPrdModelOptions`, `FolderStateKeys` |
| Tree and index (#648) | `indexTree`, `isAppliedChange`, `isOpenChange`, `isBuildingChange`, `specHash`, `nodeSpec`; types `V2Tree`, `RuleNode`, `TreeIndex`, `V2TreeEntry`, `IndexOptions` |
| Product computations (#648) | `computeProductStatus`, `productReport`, `capabilityReport`, `prdStatusReport`, `computeEdges`, `computeRealizedBy`, `computeLandings`; types `ProductStatus`, `CapabilityReport`, `PrdStatusReport`, `ProductEdges`, `Realization`, `ChangeLanding` |
| Transaction | `withPrdModelTransaction` (PRD lock held across load, mutate, write; refuses a v1 tree with `PrdLayoutError`); types `PrdModelEdit`, `PrdModelTransactionOptions`, `PrdModelTransactionResult` |
| Selection | `findNextWork`, `findActionableWork`, `resolveWorkById` (`null` for a change holding a change); `changeWorkShape` (unit, tasks or container: the one judgement selection, `resolveWorkById` and `claim_task` share); `enclosingChangeIds` (changes enclosing a ref, innermost first: a claim on any covers it, so a consumer claiming a task directly must refuse one inside a foreign-claimed change); `findNextWorkTask` (v1-shaped answer `get_next_task` returns), `completedWorkIds`; types `WorkUnit`, `WorkKind`, `WorkSelectionOptions`, `ChangeWorkShape`, `WorkShapeChild`, `NextWorkTask`, `NextWorkOptions` |
| Completion | `completeTask`, `completeChange`, `completeWork` (pure, on a `V2Tree`), `ChangeCompletionError`; `completeV2Work` (the transaction `update_task_status` runs: completes, applies per `rex.applyOn`, logs), `loadApplyOn`; types `ChangeCompletionOptions`, `ChangeCompletionResult`, `CompleteWorkOptions`, `CompleteWorkResult`, `V2Completion`, `V2CompletionOptions`, `ApplyOn` |
| Brief | `buildChangeBrief`, `renderChangeBrief`; types `ChangeBrief`, `ChangeBriefOptions`, `BriefCommands`, `BriefLogEntry` |
| Store | `ChangeLayerStore`, `isChangeLayerStore` (what `resolveStore` returns on a v2 tree) |

Covered by `packages/rex/tests/integration/public-v2-runtime.test.ts`, which imports only `public.ts`.

## Injection Seams

Some cross-zone dependencies use callback injection rather than gateway imports. These seams are invisible to static analysis:

| Injection site | Target module | Injected callbacks | Interface type |
|----------------|---------------|--------------------|----------------|
| `web/src/server/start.ts` | `web/src/server/task-usage.ts` (barrel facade over `task-usage/register-scheduler.ts`) | `broadcast`, `collectAllIds`, `loadPRD`, `getAggregator` | `RegisterSchedulerOptions` |

**Rules:**
- Prefer injection over import when the target would otherwise need to import from a higher-tier zone
- Every injection seam must have a named TypeScript interface
- New seams require an entry in this table

## Gateway JSDoc Template

```typescript
/**
 * Centralized gateway for <source-package> runtime imports.
 *
 * <Brief description of why this package needs runtime imports.>
 *
 * By concentrating all <pkg>→<source> runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (N re-exports, not M scattered imports).
 * - The DAG stays **acyclic**.
 * - Future changes to <source>'s public API need only be updated in this single file.
 *
 * @module <pkg>/<gateway-path>
 * @see <path-to-sibling-gateway> — <sibling>'s equivalent gateway
 */
```

## Testing

Every gateway must have integration tests verifying:

1. **Re-export existence** — every symbol is callable/constructible
2. **Contract correctness** — at least one end-to-end scenario through the gateway
3. **Type alignment** — type re-exports match upstream public API
