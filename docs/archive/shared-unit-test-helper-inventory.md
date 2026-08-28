# Shared Unit Test Helper Inventory

This inventory covers **unit-test helper functions defined locally in more than four unit test files**.

Scope rules used for this pass:

- Included: local helper definitions under `tests/unit/` and `packages/*/tests/unit/`
- Excluded: integration/e2e helpers, one-off helpers, and helpers already centralized
- Excluded from move candidates: same-name builders whose inputs or return types differ enough that a shared abstraction would hide test intent

## Baseline Already Shared

These patterns are already centralized and should remain shared:

| Pattern | Current shared location | Evidence | Decision |
| --- | --- | --- | --- |
| Zone analyzer fixture builders (`makeFileEntry`, `makeInventory`, `makeEdge`, `makeImports`, `makeZone`) | `packages/sourcevision/tests/unit/analyzers/zones-helpers.ts` | Imported by more than five zone-related unit suites | Keep shared as the baseline for SourceVision analyzer fixtures |
| Crash-detector constants | `packages/web/tests/helpers/crash-detector-test-support.ts` | Reused by crash-detector unit coverage without exposing production internals | Keep shared; test-only constant module is the right shape |

## Move Candidates

These patterns are materially duplicated and are good extraction targets for a later refactor.

| Pattern | Local helper(s) seen | Unit files | Recommended shared target | Why it should move |
| --- | --- | ---: | --- | --- |
| Web server route harness | `startTestServer` | 23 | `packages/web/tests/helpers/server-route-test-support.ts` | The repeated shell is the same in route tests: `createServer(...)`, permissive CORS header, `listen(0)`, 404 fallback, and `{ server, port }` return. The per-route handler can be injected as a callback. |
| Web viewer Preact render harness | `renderToDiv` | 22 | `packages/web/tests/helpers/preact-test-support.ts` | Most viewer tests recreate the same `document.createElement("div")` + `render(vnode, root)` helper. Variants differ only on whether the root is attached to `document.body`, which fits an option rather than separate local copies. |
| Web viewer visibility/RAF harness | `simulateVisibilityChange` and companion RAF helpers (`mockRAF`, `mockCancelRAF`, `flushRAF`) | 9 | `packages/web/tests/helpers/visibility-test-support.ts` | Polling and performance suites repeat the same browser-state manipulation. Consolidating this would remove brittle `Object.defineProperty(document, "visibilityState", ...)` duplication and keep fake-RAF semantics consistent. |
| Rex CLI `.rex` fixture writers | `writePRD`, `writeConfig` | 10 / 8 | `packages/rex/tests/helpers/rex-dir-test-support.ts` | CLI command suites repeatedly write `.rex/prd.json` and `.rex/config.json` with identical path logic. A shared fixture module can keep disk layout knowledge in one place without changing assertions. |

## Keep Local

These helper names show up often, but the duplication is mostly nominal rather than structural.

| Pattern | Local helper(s) seen | Unit files | Decision | Why it should stay local |
| --- | --- | ---: | --- | --- |
| Generic item builders across unrelated domains | `makeItem` | 48 | Keep local | The name collides across `PRDItem`, `PRDItemData`, `BranchWorkRecordItem`, search-index fixtures, and more. A shared `makeItem` would erase domain boundaries and force confusing overloads. |
| Proposal/task builders with suite-specific defaults | `makeProposal`, `makeTask`, `makeFeature` | 13 / 9 / 5 | Keep local or extract only per subdomain | Rex analyze tests, Rex CLI review tests, and Web proposal-editor tests use different required fields and nesting defaults. These are better kept near the suite or extracted only within one sub-area. |
| Mock store builders | `mockStore` | 6 | Keep local | The repeated name hides different contracts: some helpers return a `PRDStore`, others return a lightweight vi-mock object for tool tests. The shared surface is too weak to justify one helper. |
| Run/config builders spanning different packages | `makeRun`, `makeConfig`, `makePRD` | 8 / 6 / 8 | Keep local | The Hench, Web, and SourceVision versions target different schemas and test concerns. Same-name extraction here would create a misleading shared utility with package-specific branches. |

## Inventory Summary

Concrete move-first inventory for helpers reused in more than four unit test files:

1. Web route server harness: move
2. Web viewer render harness: move
3. Web viewer visibility/RAF harness: move
4. Rex CLI `.rex` fixture writers: move

Concrete high-frequency patterns that should remain local:

1. Cross-domain `makeItem` builders
2. Proposal/task builders with divergent defaults
3. Mock store builders with incompatible mocked surfaces
4. Package-specific run/config/PRD builders

## Notes

- Counts above are based on helper **definitions**, not helper calls.
- This inventory intentionally avoids counting helpers that are already centralized.
- The next extraction pass should favor **package-local test helpers** over a repo-wide shared test toolbox so fixture semantics stay close to the package under test.
