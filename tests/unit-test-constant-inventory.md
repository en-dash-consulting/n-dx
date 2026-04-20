# Unit Test Constant Inventory

Duplicated constants appearing in **4 or more** unit test files across the monorepo.
This inventory is the input for the "Update unit test callers to use shared utilities" task.

Each entry records: constant name, value/pattern, file list, and consolidation recommendation.

---

## 1. `originalVisibilityState` — 9 files

**Package:** `web`  
**Pattern:** `let originalVisibilityState: string;` saved in `beforeEach` and restored in `afterEach` via `setDocumentVisibility(originalVisibilityState)`.

**Files:**
- `packages/web/tests/unit/viewer/dom-update-gate.test.ts`
- `packages/web/tests/unit/viewer/execution-panel-polling.test.ts`
- `packages/web/tests/unit/viewer/loader-polling.test.ts`
- `packages/web/tests/unit/viewer/polling-manager.test.ts`
- `packages/web/tests/unit/viewer/response-buffer-gate.test.ts`
- `packages/web/tests/unit/viewer/status-indicators-polling.test.ts`
- `packages/web/tests/unit/viewer/tab-visibility.test.ts`
- `packages/web/tests/unit/viewer/tick-visibility-gate.test.ts`
- `packages/web/tests/unit/viewer/usage-polling.test.ts`

**Consolidation:** Extract a `useVisibilityRestore()` helper that calls `beforeEach`/`afterEach` to save and restore `document.visibilityState`. Target location: `packages/web/tests/unit/viewer/support/visibility.ts`.

---

## 2. `VALID_CONFIG` — 5 files

**Package:** `rex`  
**Shape:** `{ schema: "rex/v1", project: "<suite-specific>", adapter: "file" }`  
Only the `project` string differs per file; schema and adapter are identical across all five.

**Files:**
- `packages/rex/tests/unit/cli/commands/fix.test.ts` — project: `"test-fix"`
- `packages/rex/tests/unit/cli/commands/report.test.ts` — project: `"test-report"`
- `packages/rex/tests/unit/cli/commands/sync.test.ts` — project: `"test-sync"`
- `packages/rex/tests/unit/cli/commands/validate.test.ts` — project: `"test-validate"`
- `packages/rex/tests/unit/cli/commands/validate-epicless.test.ts` — project: `"test-epicless"`

**Consolidation:** Export a `makeValidConfig(project: string): RexConfig` factory from `packages/rex/tests/unit/cli/commands/support/fixtures.ts`. Each file calls `makeValidConfig("test-<name>")` instead of inlining the object.

---

## 3. `RESUME_DEBOUNCE_MS = 100` — 4 files

**Package:** `web`  
**Value:** `100` (milliseconds)  
Declared identically as `const RESUME_DEBOUNCE_MS = 100;` in each file.

**Files:**
- `packages/web/tests/unit/viewer/execution-panel-polling.test.ts`
- `packages/web/tests/unit/viewer/loader-polling.test.ts`
- `packages/web/tests/unit/viewer/status-indicators-polling.test.ts`
- `packages/web/tests/unit/viewer/usage-polling.test.ts`

**Consolidation:** Export `RESUME_DEBOUNCE_MS` from `packages/web/tests/unit/viewer/support/polling-constants.ts`.

---

## 4. `mockExecFile = vi.mocked(execFile)` — 4 files

**Packages:** `hench`, `llm-client`  
**Pattern:** `const mockExecFile = vi.mocked(execFile);` at module scope (after `vi.mock("child_process")` or similar).

**Files:**
- `packages/hench/tests/unit/agent/completion.test.ts`
- `packages/hench/tests/unit/agent/review.test.ts`
- `packages/hench/tests/unit/process/exec.test.ts`
- `packages/llm-client/tests/unit/exec.test.ts`

**Note:** These span two packages (`hench` and `llm-client`). Each file mocks its own import of `execFile`; the declaration pattern is identical but the mock registration context differs per package. A shared helper is not straightforward across packages — the consolidation opportunity is documentation of the pattern, not extraction of a cross-package utility.

**Consolidation:** Within each package, no shared file is warranted (each file has one declaration). No cross-package extraction. **Document pattern only.**

---

## 5. `mockedCallClaude = vi.mocked(callClaude)` — 4 files

**Package:** `sourcevision`  
**Pattern:** `const mockedCallClaude = vi.mocked(callClaude);` at module scope.

**Files:**
- `packages/sourcevision/tests/unit/analyzers/classify.test.ts`
- `packages/sourcevision/tests/unit/analyzers/enrich-content-skip.test.ts`
- `packages/sourcevision/tests/unit/analyzers/enrich-per-zone.test.ts`
- `packages/sourcevision/tests/unit/analyzers/zone-enrichment.test.ts`

**Consolidation:** Export `mockedCallClaude` (or re-export the mocked wrapper) from `packages/sourcevision/tests/unit/analyzers/support/claude-mock.ts`. Callers import the typed mock and call `vi.mock(...)` locally if needed.

---

## 6. `sampleDoc: PRDDocumentData` — 4 files

**Package:** `web`  
**Pattern:** `const sampleDoc: PRDDocumentData = { schema: "rex/v1", title: "Test Project", items: [...] }`  
The root fields (`schema`, `title`) are identical; the `items` tree differs per file.

**Files:**
- `packages/web/tests/unit/viewer/node-culling-integration.test.ts`
- `packages/web/tests/unit/viewer/prd-tree.test.ts`
- `packages/web/tests/unit/viewer/prune-diff-tree.test.ts`
- `packages/web/tests/unit/viewer/tree-event-delegate.test.ts`

**Consolidation:** The `items` trees are test-specific; a shared base fixture is of limited value. The consolidation candidate is the `schema`/`title` shell: export `makeDoc(items: PRDItemData[]): PRDDocumentData` from `packages/web/tests/unit/viewer/support/fixtures.ts`. Each file calls `makeDoc([...])` with its own items.

---

## Below-threshold candidates (3 files — not consolidated but noted)

| Constant | Shape | Files |
|----------|-------|-------|
| `EMPTY_PRD` / `MINIMAL_PRD` | `{ schema: "rex/v1", title: "Test Project", items: [] }` | `packages/rex/tests/unit/cli/commands/status.test.ts`, `sync.test.ts`, `usage.test.ts` |
| `ANSI_PREFIX = "\x1b["` | string | `packages/hench/tests/unit/cli/commands/run-colors.test.ts`, `packages/hench/tests/unit/cli/output.test.ts` |
| `YELLOW = "\x1b[33m"` | string | same two hench files above |

These fall below the 4-file threshold; consolidation is at the author's discretion.

---

## Suggested target files for shared utilities

| File | Constants covered |
|------|-------------------|
| `packages/web/tests/unit/viewer/support/visibility.ts` | `originalVisibilityState` + save/restore helpers |
| `packages/web/tests/unit/viewer/support/polling-constants.ts` | `RESUME_DEBOUNCE_MS` |
| `packages/web/tests/unit/viewer/support/fixtures.ts` | `makeDoc()` for `PRDDocumentData` |
| `packages/rex/tests/unit/cli/commands/support/fixtures.ts` | `makeValidConfig()` |
| `packages/sourcevision/tests/unit/analyzers/support/claude-mock.ts` | `mockedCallClaude` export |
