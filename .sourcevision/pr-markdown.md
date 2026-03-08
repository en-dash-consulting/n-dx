## Summary

**Branch:** `feature/sv-fixes-0306`
**Base:** `main`
**Completed items:** 65

| Epic | Completed |
|------|-----------|
| Repository Governance and Community Standards | 3 |

## ⚠️ Breaking Changes

- **Address relationship issues (5 findings)**
  - Hench is the only execution-layer package importing from a domain package (rex via gateway); if rex's public API changes, hench's gateway is the single choke-point — this is good design, but the gateway has no explicit version-lock or compatibility test to catch breaking changes early.
- Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status; verify whether dom-performance-monitoring imports anything from web-viewer or whether the arrow direction in the import table denotes 'exports to'. If dom does import from web-viewer, this is a circular dependency that must be resolved.
- Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually — CLI argument interfaces between cli.js and domain package CLIs are untyped; adding schema validation or contract tests would make the spawn boundary explicit.
- viewer-static-assets has zero import-graph coupling but carries hidden deployment coupling to web-dashboard via build manifest filenames; this contract is not enforced by TypeScript and breaks silently if build output names change.
- boundary-check.test.ts appears to test zone-boundary contracts rather than websocket internals; relocating it to an integration test zone would remove the external coupling that degrades this zone's cohesion score.
- **Address anti-pattern issues (13 findings)**
  - rex-gateway.ts in hench re-exports 8 functions from rex with no version-lock or compatibility smoke test; breaking changes to rex's public API will only surface at runtime inside an agent loop, making them expensive to diagnose — add a gateway compatibility test
- Call graph reports coupling=0 while cross-zone import table records 1 outgoing import to web-viewer — metric disagreement between analysis passes produces unreliable zone health scores and must be resolved before coupling data can be trusted for this zone.
- MCP HTTP transport (the recommended integration path) has no E2E test coverage; the suite tests CLI process boundaries but not the HTTP session lifecycle, leaving the primary MCP surface unvalidated at the process boundary level.
- No shared E2E fixture or helper module detected across 14 test files; duplicated process-spawn and environment setup logic increases maintenance burden and risks inconsistent test environments between files — extract common setup into a shared e2e-helpers module.
- architecture-policy.test.js encodes zone IDs and tier boundaries statically; zone renames or structural changes will not automatically invalidate the policy assertions, creating a category of silent false-passes — tie policy checks to the live zone graph output rather than hardcoded identifiers.
- CLI argument interfaces between orchestration scripts and domain package CLIs are untyped; any CLI signature change in rex, hench, or sourcevision is a silent breaking change with no compile-time or schema-level safety net — add contract tests or a shared CLI-args schema to make this boundary explicit
- usage-cleanup-scheduler.ts depends on web-viewer (the UI application layer) from within a background service zone — scheduler lifecycle should be driven by an interface or event emitter, not a direct import of the viewer module, to prevent initialization-order coupling in tests and production startup
- No shared design-token layer exists between viewer-static-assets and web-landing despite both being presentation zones in the same package; brand drift between landing page and viewer is undetectable at build time
- elapsed-time.ts and task-audit.ts are reusable UI components but are grouped with build scripts and package assets in the web-build-infrastructure zone — they should be moved to the web-viewer zone or a dedicated components zone to collocate them with their consumers and avoid accidental coupling to build tooling
- Absence of a dedicated test-support or shared-fixtures zone forces web-viewer tests to import from the low-cohesion web-unit zone (6 imports); introducing a scoped test-support module would break this dependency and allow web-unit to be dissolved or tightened
- 2 production files (websocket.ts, ws-health-tracker.ts) do not justify an independent zone boundary; absorbing them into web-dashboard would eliminate the structural noise introduced by the test-inflated coupling metric
- God function: cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions — consider decomposing into smaller, focused functions
- God function: runConfig in config.js calls 36 unique functions — consider decomposing into smaller, focused functions
- **Add CLI argument contract tests**
  CLI argument interfaces between orchestration scripts and domain package CLIs are untyped. Add contract tests that verify CLI help output matches expected argument signatures, catching silent breaking changes.
  - Contract test validates rex, hench, sourcevision CLI signatures
  - Test breaks when CLI args change without updating contract
  - Covers at least the top-level commands
- **Address pattern issues (5 findings)**
  - crash-recovery has only 1 incoming call-graph edge despite 3 cross-zone import edges from web-viewer. The zone is consumed by a single caller at runtime, making it a de facto singleton utility. This strengthens the case for absorbing it into web-dashboard as an internal sub-module rather than maintaining a separate zone boundary.
- Generated artifact HENCH_CALLGRAPH_FINDINGS.md is committed but has no CI regeneration-and-diff guard; it can silently go stale after hench source changes
- A single gateway file (src/prd/rex-gateway.ts) is the only cross-zone coupling surface for 160 files; gateway API breakage has maximum blast radius within hench — no incremental migration path exists if the rex API changes.
- Orchestration-to-domain boundary is enforced at runtime only (subprocess spawning); a mismatched CLI argument or removed subcommand will produce a silent runtime failure with no compile-time safety net.
- Zone conflates web-package unit tests with monorepo-root contract scripts; splitting into separate zones aligned to their physical location would improve discoverability and ownership clarity
- **Address pattern issues (1 findings)**
  - Redundancy cluster with highest recurrence: mcp-deps.ts @deprecated drift appears in global findings 9 (partial), 12, and 13 plus an indirect reference in finding 4 — four independent mentions, the most of any single issue. Concrete resolution steps from finding 13: run grep -r 'mcp-deps' packages/web/src/ excluding packages/web/src/server/rex-gateway.ts and packages/web/src/server/domain-gateway.ts; if the result is empty, delete packages/web/src/server/mcp-deps.ts entirely and remove any barrel re-exports referencing it; if callers remain, add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on direct mcp-deps imports and names rex-gateway.ts and domain-gateway.ts as replacements. Completing this step closes findings 9, 12, and 13 simultaneously.
- **Address suggestion issues (13 findings)**
  - Add a gateway-contract.test.ts per consumer package (hench, web) that statically asserts the exported symbol set of each gateway file matches the expected interface. This fills the gap between 'gateway file exists' (scripts) and 'CLI behavior is correct' (e2e) with a fast, precise contract layer that catches upstream renames before any process is spawned.
- Six web server route and index files directly read or write .rex/prd.json via readFileSync/writeFileSync, bypassing rex-gateway.ts entirely. This is the most critical gateway-pattern violation in the codebase: it creates six undocumented write channels to shared PRD state, each skipping rex's store-level locking and schema validation. Audit and route all web prd.json access through rex-gateway.ts.
- The packages/web/src/server/ directory contains 30 files from three zones with no subdirectory grouping. Apply a directory-per-zone convention by moving task-usage analytics files into server/usage/, mcp route files into server/mcp/, and infrastructure utilities (aggregation-cache, concurrent-execution-metrics, pr-markdown-refresh-diagnostics, process-memory-tracker) into server/infra/. This would make zone membership discoverable without running sourcevision analysis.
- The two enforcement zones (monorepo-maintenance-scripts, cli-e2e-tests) have no shared documentation of which architectural rules each owns. Add a single ENFORCEMENT.md at the monorepo root that maps each architectural constraint to its enforcement mechanism (tsc / maintenance script / architecture-policy test / e2e test), preventing future contributors from adding duplicate or conflicting enforcement for the same rule.
- packages/claude-client/ contains no source files — only a stale /dist/ and /node_modules/ from a completed migration to @n-dx/llm-client, with zero consumers in the codebase. Remove the directory to eliminate false package-count inflation and contributor confusion about which foundation package is active.
- 2 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): web-build-infrastructure, packages-rex:prd-validation — mandatory refactoring recommended before further development
- Rename the 'web-dashboard' zone to 'web-composition-root' or 'web-server-core' to accurately reflect its role as the application composition root rather than implying it only contains dashboard UI code. The current name actively misleads contributors about where server infrastructure, CLI entrypoint, and route dispatch logic live.
- The 'ndx usage' and 'ndx sync' commands have no obviously dedicated e2e test file. Confirm coverage exists in cli-delegation.test.js or add cli-usage.test.js and cli-sync.test.js to make coverage intent explicit and discoverable by file name.
- The zone has coupling 0.6 with only 3 files, meaning over half of its inter-file edges cross the zone boundary into web-dashboard. At this coupling density, any refactor of the two files it imports from web-dashboard (start.ts or rex-gateway.ts) has a direct probability of breaking this zone — add a coupling threshold alert or zone-level import test to make this fragility visible before refactors.
- config.js implements config-merging logic (deepMerge, loadJSON, saveJSON, validators) and directly reads/writes package config files rather than delegating to a spawned CLI, violating the orchestration tier's documented spawn-only rule. This is the only root orchestration script that breaks this invariant. Either extract a dedicated config subcommand in a domain package, or explicitly document config.js as a spawn-exempt exception in CLAUDE.md.
- Six web server files (routes-rex.ts, routes-validation.ts, routes-hench.ts, routes-status.ts, routes-data.ts, search-index.ts) bypass rex-gateway.ts and directly read/write .rex/prd.json via readFileSync/writeFileSync. This creates six undocumented mutation channels that skip any locking, schema validation, or migration logic in rex's store module. All prd.json access in the web package must be routed through rex-gateway.ts to close this gap.
- Zone "Web Build Infrastructure" (web-build-infrastructure) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- Zone "PRD Validation" (packages-rex:prd-validation) has critical risk (score: 0.66, cohesion: 0.34, coupling: 0.66) — requires refactoring before new feature development
- **Quick wins: rename .mjs test, add domain-gateway test, clean deprecated scripts**
  1. Rename cli-contract.test.mjs to .js for consistency with 18 peer test files
2. Add a minimal contract test for domain-gateway.ts (import symbol, assert function)
3. Clean up deprecated check-gateway-*.mjs stubs and empty test-zone-consistency.mjs
4. Document that prd.json already has schema version (finding 8 is resolved)
5. Document that gateway enforcement overlap (finding 1) is resolved (scripts deprecated)
- **Address suggestion issues (21 findings)**
  - Add a lint rule (e.g. eslint no-restricted-imports or dependency-cruiser) that flags direct cross-package imports that bypass gateway modules, including cases where a type import in a gateway-consumer file references a non-gateway path — this closes the type-import promotion erosion path.
- Add a monorepo-level zone-analysis pass that includes llm-client's internal zones so foundation-tier coupling hotspots are visible alongside domain and execution tier metrics — currently the foundation package is a structural black box in the monorepo zone graph.
- Create a shared-types.ts (or web-types.ts) neutral module within the web package to serve as the extraction target for symbols currently causing the task-usage-analytics ↔ web-dashboard and usage ↔ web-viewer cycles; without a pre-existing neutral home, developers resolving these cycles will create ad-hoc files with no clear zone assignment, likely regenerating the same structural problems
- The monorepo has no cross-package integration test zone: tests either live inside a package (unit/integration against that package's own API) or at the orchestration layer (spawn-based e2e). Direct import-level integration tests (e.g. hench importing rex's public API and asserting contract stability, web importing sourcevision's MCP factory and asserting server shape) would catch breaking API changes before they propagate to CLI-observable failures. A dedicated tests/integration/ directory at the monorepo root mirroring the package boundary graph would close this gap.
- The scheduler startup dependency (web-dashboard wires usage-cleanup-scheduler) is a hidden runtime coupling invisible to the import graph analyzer; add an integration test that boots the server and verifies the cleanup scheduler fires at the expected interval — this would make the lifecycle dependency detectable by the test suite rather than requiring code reading to discover
- Two architectural invariants (gateway re-export-only, orchestration spawn-only) are documented in CLAUDE.md but have no static enforcement. The spawn-only rule is partially covered by cli-e2e-tests behaviorally. Neither rule has an AST-level or import-graph-level automated check. Adding a single CI step that (a) walks each gateway file's AST to assert it contains only export declarations and (b) verifies orchestration-tier scripts have no library imports would convert both rules from convention to enforced invariant — the highest-leverage architecture hardening action available given the existing clean baseline.
- 8 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:notion-integration, packages-rex:data-persistence-validation, packages-rex:task-selection-engine, packages-rex:prd-fix-command, packages-rex:remote-integration, packages-rex:integration-schemas, packages-rex:mutation-commands, packages-rex:rex-status-mcp-cli — mandatory refactoring recommended before further development
- elapsed-time-memoization.test.ts tests a source file (elapsed-time.ts) that lives in web-viewer, not web-dashboard — test and source are split across zones. Dissolving the web-dashboard micro-zone into web-viewer (per zone hints) would automatically reunite the test with its subject, restoring the invariant that a test file's zone matches its source file's zone.
- The gateway re-export-only rule (gateways contain no logic, only re-exports) is documented in CLAUDE.md but unenforceable by the current CLI-spawn e2e suite. Add a lightweight static check — either a dedicated unit test that imports each gateway file and asserts it exports only re-exports with no function/class bodies, or an ESLint rule — to complement architecture-policy.test.js with a check the e2e layer cannot provide.
- Add at least a smoke-level unit test for landing.ts to confirm module initialization does not throw and any interactive handlers are wired correctly; this is the only TypeScript zone with zero test coverage and the gap is not justified by the static-asset rationale that applies to viewer-static-assets
- Add a register-scheduler.ts or lifecycle.ts file inside this zone that exports a single startUsageScheduler() function; web-dashboard would call this one function at startup, making the scheduler's wiring explicit and the zone self-contained rather than relying on web-dashboard to know internal startup details
- task-usage.ts is the public entry point but has no unit test while its internal dependencies do; this inverts the testing priority — the public API surface should have the highest test coverage density, not the lowest. Add unit tests for task-usage.ts before the zone's exported surface expands
- web-build-infrastructure is the only zone with both cohesion below 0.5 AND coupling above 0.5 simultaneously — reclassifying the four misplaced viewer files (elapsed-time.ts, use-tick.ts, route-state.ts, task-audit.ts) to web-viewer would resolve both metrics in a single targeted action with no code changes required.
- Zone "Notion Integration Adapter" (packages-rex:notion-integration) has catastrophic risk (score: 0.86, cohesion: 0.14, coupling: 0.86) — requires immediate architectural intervention
- Zone "Data Persistence & Validation" (packages-rex:data-persistence-validation) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "Task Selection Engine" (packages-rex:task-selection-engine) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "PRD Fix Command" (packages-rex:prd-fix-command) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Remote Integration" (packages-rex:remote-integration) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Integration Schemas" (packages-rex:integration-schemas) has critical risk (score: 0.69, cohesion: 0.31, coupling: 0.69) — requires refactoring before new feature development
- Zone "Mutation Commands" (packages-rex:mutation-commands) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- Zone "Rex Status & MCP CLI" (packages-rex:rex-status-mcp-cli) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development

## Major Changes

- **Address suggestion issues (17 findings)** [critical]
  - Run intra-package call-graph analysis on hench to detect any emerging circular call patterns between its internal subdirectories (agent/, prd/, tools/) before they compound — the rex circular call pattern (239+100 calls) was only found via call-graph analysis, not zone metrics, and hench's 2838 internal calls make it the most likely next site for a hidden cycle.
- Add a dependency-cruiser or similar import-boundary rule to CI that enforces the gateway pattern: any cross-package import that does not pass through the designated gateway module should fail the build. This converts a trust-based convention into a machine-enforced constraint.
- All micro-zones (< 5 production files) in the web package lack facade index modules, meaning their zone boundaries exist only in the zone detection metadata and are invisible to the TypeScript compiler — mandate an 'index.ts' barrel for every zone with 2+ production files to make zone membership compiler-visible and reduce the risk of zone boundaries eroding silently.
- Establish a documented testing convention for the utility+hook pattern: every hook wrapper (use-*.ts) should have a corresponding hook test file alongside the utility test — currently dom-performance-monitoring applies the production pattern but not the test pattern, and without a written convention future hooks will follow the same incomplete template.
- Introduce a project-wide lint rule enforcing that files in 'src/server/' cannot import from 'src/viewer/' — the two known violations (task-usage-tracking, websocket boundary-check) both evade detection because the no-upward-import convention is undocumented and unenforced; a lint rule would surface new violations at PR time rather than zone-enrichment time.
- Reconcile the two analysis passes (call-graph and cross-zone import table) that report contradictory coupling values for the dom zone — add a CI step that asserts zone IDs are consistent across both passes and flags any zone that appears in one pass but not the other, before this class of metric disagreement spreads to other zones.
- 5 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:unit-core, packages-rex:unit-cli, websocket-infrastructure, packages-sourcevision:analyzers-3, packages-rex:unit — mandatory refactoring recommended before further development
- Split the web-build-infrastructure zone into two groups: (1) build tooling (build.js, dev.js, package.json, images, markdown) and (2) reusable UI components (elapsed-time.ts, task-audit.ts) — these two groups have different change drivers, different consumers, and different lifecycle concerns that should not share a zone boundary.
- Add use-dom-performance-monitor.test.ts to cover the hook's lifecycle: verify the monitor is started on mount, stopped on unmount, and that ref changes trigger re-subscription — the utility has test coverage but the hook wrapper that most consumers interact with does not.
- Document the execution log rotation policy (max file size, max file count, rotation trigger) in .rex/config.json or a companion README to prevent unbounded log accumulation and clarify when execution-log.1.jsonl vs execution-log.jsonl is the authoritative current log.
- Neither source file in this zone exports through a shared index — introduce a thin 'index.ts' barrel that re-exports the public surfaces of both services, giving the zone an explicit boundary and preventing consumers from coupling to internal file paths.
- websocket-infrastructure breaches both cohesion (<0.5) and coupling (>0.5) thresholds simultaneously — this double breach qualifies it as the highest-priority structural risk in the web package; dissolve the zone by absorbing websocket.ts and ws-health-tracker.ts into web-dashboard and relocating boundary-check.test.ts to the integration test suite.
- Zone "WebSocket Infrastructure" (websocket-infrastructure) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Unit Core" (packages-rex:unit-core) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "Unit Cli" (packages-rex:unit-cli) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Analyzers 3" (packages-sourcevision:analyzers-3) has critical risk (score: 0.69, cohesion: 0.31, coupling: 0.69) — requires refactoring before new feature development
- Zone "Unit" (packages-rex:unit) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- **Address suggestion issues (9 findings)** [critical]
  - Add a pnpm verify script (or Makefile target) that runs all three verification-tier mechanisms in sequence: vitest e2e, check-gateway-regex.mjs, check-gateway-test.mjs, and test-zone-consistency.mjs — removes the current requirement for contributors to manually discover and run four separate commands
- Add an intra-package layer-direction check to architecture-policy.test.js that parses import paths within each package and asserts domain files do not import from cli/ subdirectories — directly guards the existing packages-rex circular sub-zone violation and prevents recurrence
- Create a single gateway-rules.json (or equivalent) at the monorepo root that both check-gateway-regex.mjs and architecture-policy.test.js consume as the authoritative source of gateway file paths and allowed import patterns — eliminates silent divergence between two enforcement mechanisms
- packages/hench/package-lock.json should not exist in a pnpm workspace. It can cause dependency resolution conflicts if npm is run inside the package. Verify it is not committed to source control or add it to .gitignore, and document that pnpm is the sole package manager for this monorepo.
- Add a dedicated intra-package layering test (e.g., in architecture-policy.test.js) that asserts domain-layer files do not import from CLI-layer files within the same package — this would catch the existing packages-rex:unit-analyze→cli violation and prevent recurrence
- Zone "Crash Recovery" (crash-recovery) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- The fix for the useState misuse in analyze-panel.ts requires two coordinated edits: (1) add useEffect to the import on line 9: `import { useState, useCallback, useEffect } from 'preact/hooks'`, and (2) replace line 74 with `useEffect(() => { loadPending(); }, [])`. Both changes must land together — changing line 74 without updating the import will fail the TypeScript build.
- Add a self-test or snapshot fixture to check-gateway-regex.mjs and check-gateway-test.mjs that validates the regex patterns catch known-bad imports — untested validators provide false confidence
- Bind the gateway check scripts to gateway file paths via a shared config constant rather than hardcoded regex strings, so renaming a gateway file breaks the check explicitly rather than silently
- **Repository Governance and Community Standards**
- **Address suggestion issues (1 findings)** [critical]
  - Zone "Crash Recovery" (crash-recovery) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- **Address suggestion issues (3 findings)** [critical]
  - Move check-gateway-regex.mjs and check-gateway-test.mjs to the top-level scripts/ directory (which already exists as its own zone). This single change resolves three compounding issues simultaneously: it eliminates the cohesion-1 metric artifact in web-landing (finding 4), removes the gateway-filename namespace collision flagged in finding 6, and correctly co-locates the files with other governance/CI scripts where they semantically belong. No rename is required if the files are relocated to scripts/ — the naming ambiguity only exists because they share a directory with production landing assets.
- Set the archetype of landing.ts to [entrypoint] in sourcevision metadata. Findings 3 and 5 independently identify the same misclassification: a file that bootstraps the landing page is currently typed as [service], which excludes it from entrypoint-based dead-code detection and bundle entry audits. The fix is a one-line archetype override — no code change required.
- Zone "Web Unit" (web-unit) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- **Address anti-pattern issues (12 findings)** [critical]
  - architecture-policy.test.js and check-gateway-*.mjs in monorepo-maintenance-scripts likely enforce overlapping gateway constraints via different mechanisms (test harness vs. raw script) — without explicit documentation of which rules live where, the two enforcement layers will drift when rules are updated.
- cli-contract.test.mjs uses .mjs while all 18 peer files use .js — module format inconsistency in a vitest suite can cause silent resolution differences if the runner applies different transform pipelines to .mjs vs .js files; standardize to .js.
- Hench and rex are independently buildable packages with no runtime version assertion. A mismatch between hench dist/ and installed rex version will produce a silent behavioral failure rather than a clear compatibility error at startup.
- domain-gateway.ts has no dedicated test. As the sole web→sourcevision import seam, a silent re-export breakage (e.g. sourcevision renames createSourcevisionMcpServer) would only be caught when a route request reaches the MCP handler at runtime — not during build or test. A minimal gateway contract test (import the symbol, assert it is a function) would catch this at CI time.
- Maintenance scripts use .mjs (untyped) while the entire source base is TypeScript — structural validation scripts that enforce TypeScript architectural rules are themselves exempt from TypeScript's type checking, creating an ironic enforcement gap where the enforcer cannot be enforced.
- Root orchestration scripts (cli.js, web.js, ci.js) are plain JS in a TypeScript monorepo, making cross-package API breakage undetectable at typecheck time. Even a full pnpm typecheck pass will not catch broken orchestration contracts.
- pending-proposals.json is written by rex analyze and read by rex recommend with no file-level locking. Concurrent CLI invocations (common in CI) can produce a torn read/write on this file.
- prd.json lacks a schema version field, making it impossible for consumers (hench, web) to detect format incompatibility at load time. A silent schema mismatch between package versions will corrupt PRD state without a diagnostic error.
- rex-gateway.ts re-exports 35+ symbols covering domain types, constants, tree utilities, analytics, health, and reshape operations — it mirrors the entire rex public API rather than defining a minimal web-specific interface. A true gateway should expose only what consumers need, providing a stable seam; a full-mirror gateway offers no stability guarantee and generates false confidence that coupling is controlled.
- routes-rex.ts is a 1000+ line file that handles route dispatch, input validation, tree mutations, prune logic, merge orchestration, analysis triggering, and requirements CRUD — it has at least 6 distinct responsibilities. This makes it the highest-risk file in the monorepo: a change to any one concern (e.g. prune logic) requires reading and testing the entire file.
- God function: cmdStatus in packages/rex/src/cli/commands/status.ts calls 36 unique functions — consider decomposing into smaller, focused functions
- God function: <module> in scripts/hench-callgraph-analysis.mjs calls 33 unique functions — consider decomposing into smaller, focused functions
- **Gateway re-export-only and orchestration spawn-only static enforcement** [critical]
  Add AST-level checks: (a) gateway files contain only re-export declarations, no logic (b) orchestration-tier scripts have no library imports. Addresses findings 1, 6, 9.

## Completed Work

### Repository Governance and Community Standards

**Code of Conduct**
- Add CODE_OF_CONDUCT.md placeholder to repository root
- Wire CODE_OF_CONDUCT.md into package metadata and CI validation

- Code of Conduct *(feature)*
  Establish a code of conduct document for the repository to set community and contributor expectations.

### (Ungrouped)

**Address anti-pattern issues (12 findings)**
- ⚠️ **Quick wins: rename .mjs test, add domain-gateway test, clean deprecated scripts**
  1. Rename cli-contract.test.mjs to .js for consistency with 18 peer test files
2. Add a minimal contract test for domain-gateway.ts (import symbol, assert function)
3. Clean up deprecated check-gateway-*.mjs stubs and empty test-zone-consistency.mjs
4. Document that prd.json already has schema version (finding 8 is resolved)
5. Document that gateway enforcement overlap (finding 1) is resolved (scripts deprecated)
- Add file-level locking for pending-proposals.json
- Add runtime version compatibility check between hench and rex
- Decompose routes-rex.ts into focused route modules
- Trim rex-gateway.ts to minimal web-specific interface
- Decompose cmdStatus into focused rendering functions

**Address anti-pattern issues (13 findings)**
- ⚠️ **Add CLI argument contract tests**
  CLI argument interfaces between orchestration scripts and domain package CLIs are untyped. Add contract tests that verify CLI help output matches expected argument signatures, catching silent breaking changes.
  - Contract test validates rex, hench, sourcevision CLI signatures
  - Test breaks when CLI args change without updating contract
  - Covers at least the top-level commands
- Add gateway compatibility test for hench rex-gateway
  rex-gateway.ts in hench re-exports 8+ functions from rex with no version-lock or compatibility smoke test. Add a test that verifies all re-exported functions exist and are callable, so rex API changes are caught at test time rather than at runtime inside agent loops.
  - Gateway compatibility test exists in hench test suite
  - Test verifies all re-exported functions are defined and callable
  - Test fails if any re-exported function is removed from rex public API
- Extract shared E2E test helpers module
  No shared E2E fixture or helper module across 14 test files. Extract common process-spawn, environment setup, and cleanup logic into a shared e2e-helpers module to reduce duplication and ensure consistent test environments.
  - Shared e2e-helpers module exists in tests/e2e/
  - Common spawn/setup patterns extracted from existing tests
  - At least 3 existing test files updated to use shared helpers
- Decompose cmdAnalyze god function
  cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions. Decompose into smaller, focused phases (config resolution, scanning, proposal processing, acceptance).
  - cmdAnalyze broken into named sub-functions
  - Each extracted function has a clear single responsibility
  - Existing tests continue to pass
- Decompose runConfig god function
  runConfig in config.js calls 36 unique functions. Decompose into smaller, focused functions for each config section handler.
  - runConfig broken into named sub-functions
  - Each section handler is its own function
  - Existing tests continue to pass
- Fix usage-cleanup-scheduler web-viewer coupling
- Move elapsed-time.ts and task-audit.ts to viewer zone
- Absorb websocket zone into web-dashboard
- Tie architecture policy test to live zone graph

**Address observation issues (10 findings)**
- Pin crash-recovery and web-package-scaffold UI files to correct zones
  Add zone pins in .n-dx.json for: crash-detector.ts, use-crash-recovery.ts, crash-recovery-banner.ts, crash-detector-test-support.ts, crash-detector.test.ts → web-dashboard; route-state.ts, use-tick.ts, lazy-children.ts, listener-lifecycle.ts → web-dashboard. This resolves findings 1-3, 5, 8, 10.
- Add unit test for use-crash-recovery.ts hook
  Write unit tests for the useCrashRecovery Preact hook covering: initial detection, state saving on view changes, dismiss/restore actions, disabled mode, and crash loop detection. Finding 4.
- Add unit tests for analyze-panel.ts and proposal-editor.ts
  Write unit tests for the two complex PRD analysis UI components. Finding 9.
- Document fan-in hotspot and review web-dashboard entry points

**Address relationship issues (5 findings)**
- Verify dom→web-viewer cross-zone import direction is not circular
  Finding #2: Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status. Verify the import direction and document/resolve.
- Add CLI spawn boundary contract tests
  Finding #3: Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually. Add contract tests that verify each domain CLI accepts the expected arguments and returns expected exit codes.
- Add viewer build output contract assertion
  Finding #4: viewer-static-assets has hidden deployment coupling to web-dashboard via build manifest filenames. Add a contract test that verifies expected build outputs exist after build.
- Relocate boundary-check.test.ts to integration tests

**Address suggestion issues (17 findings)**
- Add gateway pattern import boundary enforcement to CI
  Add an eslint rule or custom CI check that enforces the gateway pattern: any cross-package runtime import that does not pass through the designated gateway module should fail the build. Also add a rule preventing src/server/ from importing src/viewer/ in the web package. Covers findings: gateway pattern CI enforcement, server/viewer import boundary.
  - CI step validates that cross-package imports only go through gateway modules
  - ESLint or custom rule prevents packages/web/src/server/ from importing packages/web/src/viewer/
  - Existing code passes the new rules (no false positives)
- Add use-dom-performance-monitor hook test and document utility+hook testing convention
  Write use-dom-performance-monitor.test.ts covering hook lifecycle: monitor started on mount, stopped on unmount, ref changes trigger re-subscription. Document the testing convention for utility+hook pattern in PACKAGE_GUIDELINES.md.
  - use-dom-performance-monitor.test.ts exists with mount/unmount/ref-change tests
  - PACKAGE_GUIDELINES.md documents the utility+hook testing convention
  - Tests pass in CI
- Address high-risk zone metrics (5 zones exceeding thresholds)
  Address the 5 zones exceeding architectural risk thresholds: packages-rex:unit-core (0.83 risk), packages-rex:unit-cli (0.75 risk), websocket-infrastructure (0.75 risk), packages-sourcevision:analyzers-3 (0.69 risk), packages-rex:unit (0.67 risk). Dissolve websocket-infrastructure by absorbing into web-dashboard. Split web-build-infrastructure into build tooling and UI components. Investigate and refactor rex zones for better cohesion/coupling.
  - websocket-infrastructure zone dissolved into web-dashboard
  - web-build-infrastructure split into build tooling and UI components
  - All 5 high-risk zones show improved metrics or have documented justification for current structure
- Add barrel index.ts for web micro-zones and dom-performance-monitoring zone
- Document execution log rotation policy
- Hench call-graph analysis and analysis pass reconciliation

**Address suggestion issues (21 findings)**
- 🔶 **Gateway re-export-only and orchestration spawn-only static enforcement**
  Add AST-level checks: (a) gateway files contain only re-export declarations, no logic (b) orchestration-tier scripts have no library imports. Addresses findings 1, 6, 9.
- Create shared-types.ts and register-scheduler.ts neutral modules
  Create shared-types.ts in web package to break task-usage-analytics ↔ web-dashboard cycles. Create register-scheduler.ts in usage cleanup zone to make scheduler wiring explicit. Addresses findings 3, 11.
- Test coverage: landing.ts smoke test and task-usage.ts unit tests
  Add smoke test for landing.ts (zero coverage zone). Add unit tests for task-usage.ts public API. Addresses findings 10, 12.
- Rex zone refactoring: 8 high-risk zones
  Address 8 rex zones exceeding risk thresholds: notion-integration, data-persistence-validation, task-selection-engine, prd-fix-command, remote-integration, integration-schemas, mutation-commands, rex-status-mcp-cli. Addresses findings 7, 14-21.

- 🔶 **Address suggestion issues (17 findings)** *(feature)*
  - Run intra-package call-graph analysis on hench to detect any emerging circular call patterns between its internal subdirectories (agent/, prd/, tools/) before they compound — the rex circular call pattern (239+100 calls) was only found via call-graph analysis, not zone metrics, and hench's 2838 internal calls make it the most likely next site for a hidden cycle.
- Add a dependency-cruiser or similar import-boundary rule to CI that enforces the gateway pattern: any cross-package import that does not pass through the designated gateway module should fail the build. This converts a trust-based convention into a machine-enforced constraint.
- All micro-zones (< 5 production files) in the web package lack facade index modules, meaning their zone boundaries exist only in the zone detection metadata and are invisible to the TypeScript compiler — mandate an 'index.ts' barrel for every zone with 2+ production files to make zone membership compiler-visible and reduce the risk of zone boundaries eroding silently.
- Establish a documented testing convention for the utility+hook pattern: every hook wrapper (use-*.ts) should have a corresponding hook test file alongside the utility test — currently dom-performance-monitoring applies the production pattern but not the test pattern, and without a written convention future hooks will follow the same incomplete template.
- Introduce a project-wide lint rule enforcing that files in 'src/server/' cannot import from 'src/viewer/' — the two known violations (task-usage-tracking, websocket boundary-check) both evade detection because the no-upward-import convention is undocumented and unenforced; a lint rule would surface new violations at PR time rather than zone-enrichment time.
- Reconcile the two analysis passes (call-graph and cross-zone import table) that report contradictory coupling values for the dom zone — add a CI step that asserts zone IDs are consistent across both passes and flags any zone that appears in one pass but not the other, before this class of metric disagreement spreads to other zones.
- 5 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:unit-core, packages-rex:unit-cli, websocket-infrastructure, packages-sourcevision:analyzers-3, packages-rex:unit — mandatory refactoring recommended before further development
- Split the web-build-infrastructure zone into two groups: (1) build tooling (build.js, dev.js, package.json, images, markdown) and (2) reusable UI components (elapsed-time.ts, task-audit.ts) — these two groups have different change drivers, different consumers, and different lifecycle concerns that should not share a zone boundary.
- Add use-dom-performance-monitor.test.ts to cover the hook's lifecycle: verify the monitor is started on mount, stopped on unmount, and that ref changes trigger re-subscription — the utility has test coverage but the hook wrapper that most consumers interact with does not.
- Document the execution log rotation policy (max file size, max file count, rotation trigger) in .rex/config.json or a companion README to prevent unbounded log accumulation and clarify when execution-log.1.jsonl vs execution-log.jsonl is the authoritative current log.
- Neither source file in this zone exports through a shared index — introduce a thin 'index.ts' barrel that re-exports the public surfaces of both services, giving the zone an explicit boundary and preventing consumers from coupling to internal file paths.
- websocket-infrastructure breaches both cohesion (<0.5) and coupling (>0.5) thresholds simultaneously — this double breach qualifies it as the highest-priority structural risk in the web package; dissolve the zone by absorbing websocket.ts and ws-health-tracker.ts into web-dashboard and relocating boundary-check.test.ts to the integration test suite.
- Zone "WebSocket Infrastructure" (websocket-infrastructure) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Unit Core" (packages-rex:unit-core) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "Unit Cli" (packages-rex:unit-cli) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Analyzers 3" (packages-sourcevision:analyzers-3) has critical risk (score: 0.69, cohesion: 0.31, coupling: 0.69) — requires refactoring before new feature development
- Zone "Unit" (packages-rex:unit) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- ⚠️ **Address relationship issues (5 findings)** *(feature)*
  - Hench is the only execution-layer package importing from a domain package (rex via gateway); if rex's public API changes, hench's gateway is the single choke-point — this is good design, but the gateway has no explicit version-lock or compatibility test to catch breaking changes early.
- Cross-zone import direction 'dom → web-viewer' conflicts with documented leaf-node status; verify whether dom-performance-monitoring imports anything from web-viewer or whether the arrow direction in the import table denotes 'exports to'. If dom does import from web-viewer, this is a circular dependency that must be resolved.
- Orchestration layer's zero-coupling guarantee is enforced structurally but not contractually — CLI argument interfaces between cli.js and domain package CLIs are untyped; adding schema validation or contract tests would make the spawn boundary explicit.
- viewer-static-assets has zero import-graph coupling but carries hidden deployment coupling to web-dashboard via build manifest filenames; this contract is not enforced by TypeScript and breaks silently if build output names change.
- boundary-check.test.ts appears to test zone-boundary contracts rather than websocket internals; relocating it to an integration test zone would remove the external coupling that degrades this zone's cohesion score.
- ⚠️ **Address anti-pattern issues (13 findings)** *(feature)*
  - rex-gateway.ts in hench re-exports 8 functions from rex with no version-lock or compatibility smoke test; breaking changes to rex's public API will only surface at runtime inside an agent loop, making them expensive to diagnose — add a gateway compatibility test
- Call graph reports coupling=0 while cross-zone import table records 1 outgoing import to web-viewer — metric disagreement between analysis passes produces unreliable zone health scores and must be resolved before coupling data can be trusted for this zone.
- MCP HTTP transport (the recommended integration path) has no E2E test coverage; the suite tests CLI process boundaries but not the HTTP session lifecycle, leaving the primary MCP surface unvalidated at the process boundary level.
- No shared E2E fixture or helper module detected across 14 test files; duplicated process-spawn and environment setup logic increases maintenance burden and risks inconsistent test environments between files — extract common setup into a shared e2e-helpers module.
- architecture-policy.test.js encodes zone IDs and tier boundaries statically; zone renames or structural changes will not automatically invalidate the policy assertions, creating a category of silent false-passes — tie policy checks to the live zone graph output rather than hardcoded identifiers.
- CLI argument interfaces between orchestration scripts and domain package CLIs are untyped; any CLI signature change in rex, hench, or sourcevision is a silent breaking change with no compile-time or schema-level safety net — add contract tests or a shared CLI-args schema to make this boundary explicit
- usage-cleanup-scheduler.ts depends on web-viewer (the UI application layer) from within a background service zone — scheduler lifecycle should be driven by an interface or event emitter, not a direct import of the viewer module, to prevent initialization-order coupling in tests and production startup
- No shared design-token layer exists between viewer-static-assets and web-landing despite both being presentation zones in the same package; brand drift between landing page and viewer is undetectable at build time
- elapsed-time.ts and task-audit.ts are reusable UI components but are grouped with build scripts and package assets in the web-build-infrastructure zone — they should be moved to the web-viewer zone or a dedicated components zone to collocate them with their consumers and avoid accidental coupling to build tooling
- Absence of a dedicated test-support or shared-fixtures zone forces web-viewer tests to import from the low-cohesion web-unit zone (6 imports); introducing a scoped test-support module would break this dependency and allow web-unit to be dissolved or tightened
- 2 production files (websocket.ts, ws-health-tracker.ts) do not justify an independent zone boundary; absorbing them into web-dashboard would eliminate the structural noise introduced by the test-inflated coupling metric
- God function: cmdAnalyze in packages/rex/src/cli/commands/analyze.ts calls 44 unique functions — consider decomposing into smaller, focused functions
- God function: runConfig in config.js calls 36 unique functions — consider decomposing into smaller, focused functions
- 🔶 **Address suggestion issues (9 findings)** *(feature)*
  - Add a pnpm verify script (or Makefile target) that runs all three verification-tier mechanisms in sequence: vitest e2e, check-gateway-regex.mjs, check-gateway-test.mjs, and test-zone-consistency.mjs — removes the current requirement for contributors to manually discover and run four separate commands
- Add an intra-package layer-direction check to architecture-policy.test.js that parses import paths within each package and asserts domain files do not import from cli/ subdirectories — directly guards the existing packages-rex circular sub-zone violation and prevents recurrence
- Create a single gateway-rules.json (or equivalent) at the monorepo root that both check-gateway-regex.mjs and architecture-policy.test.js consume as the authoritative source of gateway file paths and allowed import patterns — eliminates silent divergence between two enforcement mechanisms
- packages/hench/package-lock.json should not exist in a pnpm workspace. It can cause dependency resolution conflicts if npm is run inside the package. Verify it is not committed to source control or add it to .gitignore, and document that pnpm is the sole package manager for this monorepo.
- Add a dedicated intra-package layering test (e.g., in architecture-policy.test.js) that asserts domain-layer files do not import from CLI-layer files within the same package — this would catch the existing packages-rex:unit-analyze→cli violation and prevent recurrence
- Zone "Crash Recovery" (crash-recovery) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- The fix for the useState misuse in analyze-panel.ts requires two coordinated edits: (1) add useEffect to the import on line 9: `import { useState, useCallback, useEffect } from 'preact/hooks'`, and (2) replace line 74 with `useEffect(() => { loadPending(); }, [])`. Both changes must land together — changing line 74 without updating the import will fail the TypeScript build.
- Add a self-test or snapshot fixture to check-gateway-regex.mjs and check-gateway-test.mjs that validates the regex patterns catch known-bad imports — untested validators provide false confidence
- Bind the gateway check scripts to gateway file paths via a shared config constant rather than hardcoded regex strings, so renaming a gateway file breaks the check explicitly rather than silently
- ⚠️ **Address pattern issues (5 findings)** *(feature)*
  - crash-recovery has only 1 incoming call-graph edge despite 3 cross-zone import edges from web-viewer. The zone is consumed by a single caller at runtime, making it a de facto singleton utility. This strengthens the case for absorbing it into web-dashboard as an internal sub-module rather than maintaining a separate zone boundary.
- Generated artifact HENCH_CALLGRAPH_FINDINGS.md is committed but has no CI regeneration-and-diff guard; it can silently go stale after hench source changes
- A single gateway file (src/prd/rex-gateway.ts) is the only cross-zone coupling surface for 160 files; gateway API breakage has maximum blast radius within hench — no incremental migration path exists if the rex API changes.
- Orchestration-to-domain boundary is enforced at runtime only (subprocess spawning); a mismatched CLI argument or removed subcommand will produce a silent runtime failure with no compile-time safety net.
- Zone conflates web-package unit tests with monorepo-root contract scripts; splitting into separate zones aligned to their physical location would improve discoverability and ownership clarity
- 🔶 **Repository Governance and Community Standards** *(epic)*
- 🔶 **Address suggestion issues (1 findings)** *(feature)*
  - Zone "Crash Recovery" (crash-recovery) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- 🔶 **Address suggestion issues (3 findings)** *(feature)*
  - Move check-gateway-regex.mjs and check-gateway-test.mjs to the top-level scripts/ directory (which already exists as its own zone). This single change resolves three compounding issues simultaneously: it eliminates the cohesion-1 metric artifact in web-landing (finding 4), removes the gateway-filename namespace collision flagged in finding 6, and correctly co-locates the files with other governance/CI scripts where they semantically belong. No rename is required if the files are relocated to scripts/ — the naming ambiguity only exists because they share a directory with production landing assets.
- Set the archetype of landing.ts to [entrypoint] in sourcevision metadata. Findings 3 and 5 independently identify the same misclassification: a file that bootstraps the landing page is currently typed as [service], which excludes it from entrypoint-based dead-code detection and bundle entry audits. The fix is a one-line archetype override — no code change required.
- Zone "Web Unit" (web-unit) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- ⚠️ **Address pattern issues (1 findings)** *(feature)*
  - Redundancy cluster with highest recurrence: mcp-deps.ts @deprecated drift appears in global findings 9 (partial), 12, and 13 plus an indirect reference in finding 4 — four independent mentions, the most of any single issue. Concrete resolution steps from finding 13: run grep -r 'mcp-deps' packages/web/src/ excluding packages/web/src/server/rex-gateway.ts and packages/web/src/server/domain-gateway.ts; if the result is empty, delete packages/web/src/server/mcp-deps.ts entirely and remove any barrel re-exports referencing it; if callers remain, add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on direct mcp-deps imports and names rex-gateway.ts and domain-gateway.ts as replacements. Completing this step closes findings 9, 12, and 13 simultaneously.
- ⚠️ **Address suggestion issues (13 findings)** *(feature)*
  - Add a gateway-contract.test.ts per consumer package (hench, web) that statically asserts the exported symbol set of each gateway file matches the expected interface. This fills the gap between 'gateway file exists' (scripts) and 'CLI behavior is correct' (e2e) with a fast, precise contract layer that catches upstream renames before any process is spawned.
- Six web server route and index files directly read or write .rex/prd.json via readFileSync/writeFileSync, bypassing rex-gateway.ts entirely. This is the most critical gateway-pattern violation in the codebase: it creates six undocumented write channels to shared PRD state, each skipping rex's store-level locking and schema validation. Audit and route all web prd.json access through rex-gateway.ts.
- The packages/web/src/server/ directory contains 30 files from three zones with no subdirectory grouping. Apply a directory-per-zone convention by moving task-usage analytics files into server/usage/, mcp route files into server/mcp/, and infrastructure utilities (aggregation-cache, concurrent-execution-metrics, pr-markdown-refresh-diagnostics, process-memory-tracker) into server/infra/. This would make zone membership discoverable without running sourcevision analysis.
- The two enforcement zones (monorepo-maintenance-scripts, cli-e2e-tests) have no shared documentation of which architectural rules each owns. Add a single ENFORCEMENT.md at the monorepo root that maps each architectural constraint to its enforcement mechanism (tsc / maintenance script / architecture-policy test / e2e test), preventing future contributors from adding duplicate or conflicting enforcement for the same rule.
- packages/claude-client/ contains no source files — only a stale /dist/ and /node_modules/ from a completed migration to @n-dx/llm-client, with zero consumers in the codebase. Remove the directory to eliminate false package-count inflation and contributor confusion about which foundation package is active.
- 2 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): web-build-infrastructure, packages-rex:prd-validation — mandatory refactoring recommended before further development
- Rename the 'web-dashboard' zone to 'web-composition-root' or 'web-server-core' to accurately reflect its role as the application composition root rather than implying it only contains dashboard UI code. The current name actively misleads contributors about where server infrastructure, CLI entrypoint, and route dispatch logic live.
- The 'ndx usage' and 'ndx sync' commands have no obviously dedicated e2e test file. Confirm coverage exists in cli-delegation.test.js or add cli-usage.test.js and cli-sync.test.js to make coverage intent explicit and discoverable by file name.
- The zone has coupling 0.6 with only 3 files, meaning over half of its inter-file edges cross the zone boundary into web-dashboard. At this coupling density, any refactor of the two files it imports from web-dashboard (start.ts or rex-gateway.ts) has a direct probability of breaking this zone — add a coupling threshold alert or zone-level import test to make this fragility visible before refactors.
- config.js implements config-merging logic (deepMerge, loadJSON, saveJSON, validators) and directly reads/writes package config files rather than delegating to a spawned CLI, violating the orchestration tier's documented spawn-only rule. This is the only root orchestration script that breaks this invariant. Either extract a dedicated config subcommand in a domain package, or explicitly document config.js as a spawn-exempt exception in CLAUDE.md.
- Six web server files (routes-rex.ts, routes-validation.ts, routes-hench.ts, routes-status.ts, routes-data.ts, search-index.ts) bypass rex-gateway.ts and directly read/write .rex/prd.json via readFileSync/writeFileSync. This creates six undocumented mutation channels that skip any locking, schema validation, or migration logic in rex's store module. All prd.json access in the web package must be routed through rex-gateway.ts to close this gap.
- Zone "Web Build Infrastructure" (web-build-infrastructure) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- Zone "PRD Validation" (packages-rex:prd-validation) has critical risk (score: 0.66, cohesion: 0.34, coupling: 0.66) — requires refactoring before new feature development
- 🔶 **Address anti-pattern issues (12 findings)** *(feature)*
  - architecture-policy.test.js and check-gateway-*.mjs in monorepo-maintenance-scripts likely enforce overlapping gateway constraints via different mechanisms (test harness vs. raw script) — without explicit documentation of which rules live where, the two enforcement layers will drift when rules are updated.
- cli-contract.test.mjs uses .mjs while all 18 peer files use .js — module format inconsistency in a vitest suite can cause silent resolution differences if the runner applies different transform pipelines to .mjs vs .js files; standardize to .js.
- Hench and rex are independently buildable packages with no runtime version assertion. A mismatch between hench dist/ and installed rex version will produce a silent behavioral failure rather than a clear compatibility error at startup.
- domain-gateway.ts has no dedicated test. As the sole web→sourcevision import seam, a silent re-export breakage (e.g. sourcevision renames createSourcevisionMcpServer) would only be caught when a route request reaches the MCP handler at runtime — not during build or test. A minimal gateway contract test (import the symbol, assert it is a function) would catch this at CI time.
- Maintenance scripts use .mjs (untyped) while the entire source base is TypeScript — structural validation scripts that enforce TypeScript architectural rules are themselves exempt from TypeScript's type checking, creating an ironic enforcement gap where the enforcer cannot be enforced.
- Root orchestration scripts (cli.js, web.js, ci.js) are plain JS in a TypeScript monorepo, making cross-package API breakage undetectable at typecheck time. Even a full pnpm typecheck pass will not catch broken orchestration contracts.
- pending-proposals.json is written by rex analyze and read by rex recommend with no file-level locking. Concurrent CLI invocations (common in CI) can produce a torn read/write on this file.
- prd.json lacks a schema version field, making it impossible for consumers (hench, web) to detect format incompatibility at load time. A silent schema mismatch between package versions will corrupt PRD state without a diagnostic error.
- rex-gateway.ts re-exports 35+ symbols covering domain types, constants, tree utilities, analytics, health, and reshape operations — it mirrors the entire rex public API rather than defining a minimal web-specific interface. A true gateway should expose only what consumers need, providing a stable seam; a full-mirror gateway offers no stability guarantee and generates false confidence that coupling is controlled.
- routes-rex.ts is a 1000+ line file that handles route dispatch, input validation, tree mutations, prune logic, merge orchestration, analysis triggering, and requirements CRUD — it has at least 6 distinct responsibilities. This makes it the highest-risk file in the monorepo: a change to any one concern (e.g. prune logic) requires reading and testing the entire file.
- God function: cmdStatus in packages/rex/src/cli/commands/status.ts calls 36 unique functions — consider decomposing into smaller, focused functions
- God function: <module> in scripts/hench-callgraph-analysis.mjs calls 33 unique functions — consider decomposing into smaller, focused functions
- ⚠️ **Address suggestion issues (21 findings)** *(feature)*
  - Add a lint rule (e.g. eslint no-restricted-imports or dependency-cruiser) that flags direct cross-package imports that bypass gateway modules, including cases where a type import in a gateway-consumer file references a non-gateway path — this closes the type-import promotion erosion path.
- Add a monorepo-level zone-analysis pass that includes llm-client's internal zones so foundation-tier coupling hotspots are visible alongside domain and execution tier metrics — currently the foundation package is a structural black box in the monorepo zone graph.
- Create a shared-types.ts (or web-types.ts) neutral module within the web package to serve as the extraction target for symbols currently causing the task-usage-analytics ↔ web-dashboard and usage ↔ web-viewer cycles; without a pre-existing neutral home, developers resolving these cycles will create ad-hoc files with no clear zone assignment, likely regenerating the same structural problems
- The monorepo has no cross-package integration test zone: tests either live inside a package (unit/integration against that package's own API) or at the orchestration layer (spawn-based e2e). Direct import-level integration tests (e.g. hench importing rex's public API and asserting contract stability, web importing sourcevision's MCP factory and asserting server shape) would catch breaking API changes before they propagate to CLI-observable failures. A dedicated tests/integration/ directory at the monorepo root mirroring the package boundary graph would close this gap.
- The scheduler startup dependency (web-dashboard wires usage-cleanup-scheduler) is a hidden runtime coupling invisible to the import graph analyzer; add an integration test that boots the server and verifies the cleanup scheduler fires at the expected interval — this would make the lifecycle dependency detectable by the test suite rather than requiring code reading to discover
- Two architectural invariants (gateway re-export-only, orchestration spawn-only) are documented in CLAUDE.md but have no static enforcement. The spawn-only rule is partially covered by cli-e2e-tests behaviorally. Neither rule has an AST-level or import-graph-level automated check. Adding a single CI step that (a) walks each gateway file's AST to assert it contains only export declarations and (b) verifies orchestration-tier scripts have no library imports would convert both rules from convention to enforced invariant — the highest-leverage architecture hardening action available given the existing clean baseline.
- 8 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:notion-integration, packages-rex:data-persistence-validation, packages-rex:task-selection-engine, packages-rex:prd-fix-command, packages-rex:remote-integration, packages-rex:integration-schemas, packages-rex:mutation-commands, packages-rex:rex-status-mcp-cli — mandatory refactoring recommended before further development
- elapsed-time-memoization.test.ts tests a source file (elapsed-time.ts) that lives in web-viewer, not web-dashboard — test and source are split across zones. Dissolving the web-dashboard micro-zone into web-viewer (per zone hints) would automatically reunite the test with its subject, restoring the invariant that a test file's zone matches its source file's zone.
- The gateway re-export-only rule (gateways contain no logic, only re-exports) is documented in CLAUDE.md but unenforceable by the current CLI-spawn e2e suite. Add a lightweight static check — either a dedicated unit test that imports each gateway file and asserts it exports only re-exports with no function/class bodies, or an ESLint rule — to complement architecture-policy.test.js with a check the e2e layer cannot provide.
- Add at least a smoke-level unit test for landing.ts to confirm module initialization does not throw and any interactive handlers are wired correctly; this is the only TypeScript zone with zero test coverage and the gap is not justified by the static-asset rationale that applies to viewer-static-assets
- Add a register-scheduler.ts or lifecycle.ts file inside this zone that exports a single startUsageScheduler() function; web-dashboard would call this one function at startup, making the scheduler's wiring explicit and the zone self-contained rather than relying on web-dashboard to know internal startup details
- task-usage.ts is the public entry point but has no unit test while its internal dependencies do; this inverts the testing priority — the public API surface should have the highest test coverage density, not the lowest. Add unit tests for task-usage.ts before the zone's exported surface expands
- web-build-infrastructure is the only zone with both cohesion below 0.5 AND coupling above 0.5 simultaneously — reclassifying the four misplaced viewer files (elapsed-time.ts, use-tick.ts, route-state.ts, task-audit.ts) to web-viewer would resolve both metrics in a single targeted action with no code changes required.
- Zone "Notion Integration Adapter" (packages-rex:notion-integration) has catastrophic risk (score: 0.86, cohesion: 0.14, coupling: 0.86) — requires immediate architectural intervention
- Zone "Data Persistence & Validation" (packages-rex:data-persistence-validation) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "Task Selection Engine" (packages-rex:task-selection-engine) has catastrophic risk (score: 0.83, cohesion: 0.17, coupling: 0.83) — requires immediate architectural intervention
- Zone "PRD Fix Command" (packages-rex:prd-fix-command) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Remote Integration" (packages-rex:remote-integration) has catastrophic risk (score: 0.75, cohesion: 0.25, coupling: 0.75) — requires immediate architectural intervention
- Zone "Integration Schemas" (packages-rex:integration-schemas) has critical risk (score: 0.69, cohesion: 0.31, coupling: 0.69) — requires refactoring before new feature development
- Zone "Mutation Commands" (packages-rex:mutation-commands) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- Zone "Rex Status & MCP CLI" (packages-rex:rex-status-mcp-cli) has critical risk (score: 0.67, cohesion: 0.33, coupling: 0.67) — requires refactoring before new feature development
- Address observation issues (8 findings) *(feature)*
  - Bidirectional coupling: "task-usage-tracking" ↔ "web-dashboard" (1+3 crossings) — consider extracting shared interface
- Bidirectional coupling: "web-build-infrastructure" ↔ "web-dashboard" (4+2 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- Low cohesion (0.25) — files are loosely related, consider splitting this zone
- Cohesion of 0.25 and coupling of 0.75 indicate significant structural fragmentation — likely caused by test files importing broadly from the rest of the web package.
- Only 2 of 6 files are production source; the test-to-source ratio inflates coupling scores and suggests the zone boundary is defined by test co-location rather than domain cohesion.
- The cleanup scheduler imports back into web-viewer (per cross-zone import graph), creating a dependency inversion — the scheduler should depend on an interface, not the viewer zone.
- Bidirectional imports between web and web-viewer (web→web-viewer: 4, web-viewer→web: 2) create a soft cycle risk; extracting shared primitives into a dedicated shared zone would eliminate this.
- Address pattern issues (4 findings) *(feature)*
  - E2E suite has zero source-level coupling but a hidden build-time dependency on all packages; CI must enforce a build step before e2e execution. This should be documented or enforced via a pre-test script to prevent silent false-negatives when a package fails to compile.
- The runtime-state zone is a shared mutable sink readable by both rex and hench packages without creating import-graph coupling — this is an intentional design but concurrent write safety is implicit; documenting the write-access protocol would prevent future race conditions.
- Absence of an index/facade module means task-usage-tracking has no encapsulated public surface; consumers couple directly to internal service files, weakening the zone boundary.
- Build scripts (build.js, dev.js) in this zone operate at the package boundary but are grouped with UI components (elapsed-time.ts, task-audit.ts) — splitting into a pure build-config group and a reusable-components group would clarify which files are tooling versus production API surface.
- Address observation issues (10 findings) *(feature)*
  - High coupling (0.71) — 3 imports target "web-dashboard"
- Cohesion of 0.29 is below the warning threshold — the two files in this zone (hook and detector) are more coupled to web-dashboard than to each other, suggesting a zone boundary mismatch.
- Coupling of 0.71 exceeds the warning threshold; the crash recovery subsystem has high external dependency, which reduces its reusability and increases change risk.
- use-crash-recovery.ts lacks a unit test; given that crash recovery is a reliability-critical code path, this gap should be addressed.
- Bidirectional coupling: "web-dashboard" ↔ "web-package-scaffold" (3+9 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- 9 entry points — wide API surface, consider consolidating exports
- Bidirectional imports with both 'crash' and 'panel' zones create implicit circular dependencies at the zone level; these relationships should be reviewed to ensure directional ownership is clear.
- analyze-panel.ts and proposal-editor.ts lack unit tests while the simpler smart-add-input and batch-import-panel components are tested — the more complex components should be prioritized for test coverage.
- Viewer UI files are co-classified with build scripts due to shared import edges; zone pinning for elapsed-time.ts, route-state.ts, task-audit.ts, use-tick.ts, lazy-children.ts, and listener-lifecycle.ts is recommended to correct classification.
- Address anti-pattern issues (11 findings) *(feature)*
  - E2E tests that spawn CLI subprocesses share no documented workspace isolation strategy; if tests run concurrently and both write to .rex/prd.json or .sourcevision/, results are non-deterministic. No test uses a dedicated temp directory per test file.
- `_testHelpers` is exported through the production module surface of crash-detector.ts, bundling internal implementation details (storage keys, private functions) into the public API. Test-only exports should use a separate test-support file or conditional barrel to avoid polluting the production interface.
- hench-callgraph-analysis.mjs produces HENCH_CALLGRAPH_FINDINGS.md but has no fail-fast guard that detects missing or stale input artifacts; silent success on a cold checkout produces a misleading (empty or stale) report with no error signal.
- The rex-gateway is imported directly by scattered consumer files across 160 files with no internal hench interface layer. When the rex gateway API changes, every call site must be updated individually with no intermediate abstraction to narrow the scope of change. An internal adapter or facade within hench that wraps the gateway would contain the blast radius.
- The orchestration tier's architectural boundary (no direct package imports) is enforced solely by developer convention — no ESLint rule, TypeScript path mapping, or CI check prevents a direct `import` from cli.js into a domain package. A single accidental import would collapse the tier silently.
- claude-integration.js is a service file at the monorepo root that bypasses the gateway pattern entirely. Any cross-package imports it makes are invisible to gateway audits and import-graph coupling scores, creating an unmonitored coupling surface outside all four tiers of the dependency hierarchy.
- Proposal, ProposalFeature, and ProposalTask types are defined locally in analyze-panel.ts rather than imported from a shared rex schema or gateway. The local copy will silently diverge from the API response shape if the server-side PRD proposal format changes.
- `useState(() => { loadPending(); })` in analyze-panel.ts misuses the useState initializer to trigger an async network call. This is not the intended use of the initializer (which sets initial synchronous state) and bypasses the standard effect lifecycle, making cleanup and double-invocation behavior undefined.
- Web viewer unit tests (graph-interaction.test.ts, graph-zoom.test.ts) are excluded from packages/web per-package test coverage because they reside outside the package boundary in this zone; per-package coverage reports for the web package silently undercount viewer UI test coverage.
- Zone contains files from two physically distinct roots (packages/web/tests/unit/viewer/ and tests/) with unrelated purposes; zone name 'viewer-gateway-tests' implies viewer scope only, actively misleading contributors about the gateway scripts' monorepo-wide scope. Should be split into two zones aligned to physical location and concern.
- God function: <module> in packages/web/src/landing/landing.ts calls 42 unique functions — consider decomposing into smaller, focused functions
- Address observation issues (8 findings) *(feature)*
  - cli-contract.test.mjs living alongside non-test .mjs scripts rather than in tests/e2e/ may cause it to be excluded from standard test runner discovery if glob patterns only target tests/e2e/.
- Bidirectional coupling: "web-build-tooling" ↔ "web-dashboard" (10+4 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- High coupling (0.56) — 1 imports target "web-dashboard"
- Cohesion of 0.44 is below the recommended 0.5 threshold; the three components (smart-add-input, proposal-editor, batch-import-panel) may have been grouped algorithmically by shared test imports rather than by meaningful domain affinity.
- Coupling of 0.56 approaches the high-coupling threshold; auditing which viewer internals these components import could reveal opportunities to depend on stable public APIs instead.
- Bidirectional import coupling between web and web-viewer (10 web→web-viewer, 4 web-viewer→web) is the primary cause of the 0.42 coupling score; the web-viewer→web direction should be audited to ensure viewer code is not importing build infrastructure.
- Cohesion of 0.58 is below the ideal threshold because viewer UI components (elapsed-time.ts, use-tick.ts, route-state.ts, task-audit.ts) are co-classified with build scripts — reclassifying them into web-viewer would restore cohesion for both zones.
- Address anti-pattern issues (1 findings) *(feature)*
  - God function: agentLoop in packages/hench/src/agent/lifecycle/loop.ts calls 38 unique functions — consider decomposing into smaller, focused functions
- Address observation issues (9 findings) *(feature)*
  - High coupling (0.71) — 3 imports target "web-dashboard"
- Low cohesion (0.29) — files are loosely related, consider splitting this zone
- The mutual three-import dependency between crash-recovery and web-dashboard creates a cycle at the zone level; restructure so crash-detector.ts is a pure utility imported by the viewer, with no reverse dependency from crash-recovery back into the dashboard.
- Zone cohesion of 0.29 and coupling of 0.71 indicates the crash-recovery files are more tightly connected to external zones than to each other; consider whether crash-detector.ts and use-crash-recovery.ts belong in separate zones (utility vs. hook) or should be merged into the web-dashboard zone they depend on.
- This zone conflates two unrelated concerns: web-viewer graph interaction tests and monorepo dev-analysis scripts. It is an algorithmic artifact, not a real architectural unit.
- Bidirectional coupling: "web-build-tooling" ↔ "web-dashboard" (9+3 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- tests/check-gateway-regex.mjs and tests/check-gateway-test.mjs are developer-utility scripts unrelated to the landing page; they should be re-homed to the developer-utilities zone to keep this zone semantically coherent.
- Five viewer UI files (elapsed-time.ts, use-tick.ts, lazy-children.ts, listener-lifecycle.ts, task-audit.ts) are grouped with build infrastructure by the import graph but belong architecturally in the web-viewer zone per developer hints — setting explicit zone pins for these files would correct the misclassification.
- Address anti-pattern issues (1 findings) *(feature)*
  - God function: cmdReorganize in packages/rex/src/cli/commands/reorganize.ts calls 38 unique functions — consider decomposing into smaller, focused functions
- Address observation issues (4 findings) *(feature)*
  - Bidirectional coupling: "web" ↔ "web-viewer" (10+7 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- High coupling (0.71) — 3 imports target "web-viewer"
- Low cohesion (0.29) — files are loosely related, consider splitting this zone
- Address pattern issues (1 findings) *(feature)*
  - Perfectly isolated files (no imports in or out) always achieve cohesion: 1 by definition regardless of semantic relatedness. web-landing's perfect cohesion score is a metric artifact caused by the two governance scripts, not evidence of a genuinely cohesive zone.
- Address anti-pattern issues (1 findings) *(feature)*
  - God function: cliLoop in packages/hench/src/agent/lifecycle/cli-loop.ts calls 36 unique functions — consider decomposing into smaller, focused functions
- Address observation issues (1 findings) *(feature)*
  - Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- Address anti-pattern issues (1 findings) *(feature)*
  - God function: cmdRecommend in packages/rex/src/cli/commands/recommend.ts calls 36 unique functions — consider decomposing into smaller, focused functions
- Address suggestion issues (1 findings) *(feature)*
  - mcp-deps.ts deletion is unblocked: static analysis confirms zero runtime import callers in packages/web/src. Concrete steps: (1) delete packages/web/src/server/mcp-deps.ts, (2) update the @see JSDoc comment in packages/web/src/public.ts (lines 36–44) and packages/web/src/viewer/components/prd-tree/types.ts (line 13) to reference rex-gateway.ts and domain-gateway.ts instead, (3) add a no-restricted-imports ESLint rule in packages/web/.eslintrc.* that errors on any future direct import of mcp-deps. This closes global findings 3, 4, and 5 together.
- Address observation issues (10 findings) *(feature)*
  - cli-contract.test.mjs is the only .mjs file among .js peers — standardize to one extension to avoid potential vitest/jest config edge cases with module resolution.
- Bidirectional coupling: "mcp-route-layer" ↔ "web-dashboard" (3+2 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 23 files — high-impact module, changes may have wide ripple effects
- High coupling (0.6) — 3 imports target "web-dashboard"
- Coupling of 0.6 is elevated for a 3-file zone; the mutual import relationship with web-dashboard (each zone imports from the other) is the primary driver — extracting shared types into a dedicated types module would reduce coupling on both sides.
- Low cohesion (0.33) — files are loosely related, consider splitting this zone
- Coupling of 0.67 exceeds the healthy threshold and is an artifact of the misclassified viewer files; resolving zone membership will likely bring coupling back into range without any code changes.
- Three viewer source files (elapsed-time.ts, route-state.ts, task-audit.ts) are listed as entry points for this zone but belong in the web-viewer zone per developer-provided hints — zone membership correction is needed to restore accurate cohesion and coupling metrics.
- 9 entry points — wide API surface, consider consolidating exports
- Circular import relationship with the MCP Route Layer zone (web-viewer → web-server: 2 imports, web-server → web-viewer: 3 imports) suggests shared types or utilities that could be extracted to a shared module to eliminate the cycle.
- Address pattern issues (1 findings) *(feature)*
  - The .rex/ directory acts as an implicit inter-package message bus: rex writes proposals and PRD state, hench reads and updates task status, web serves it — treating this directory's schema as a formal versioned contract (similar to an API version) would reduce silent breakage risk.
- Address relationship issues (6 findings) *(feature)*
  - cli-e2e-tests validates CLI delegation but has no direct coverage of the MCP transport layer (HTTP session management, Streamable HTTP protocol) — MCP regressions could pass all e2e tests yet break Claude Code integration.
- Hench is the sole writer to .rex/execution-log.jsonl and a co-writer to .rex/prd.json alongside rex itself — two independent writers sharing a mutable JSON file without a locking protocol is a latent data-corruption risk if hench and rex CLI commands are ever run concurrently (e.g. in CI).
- Rex MCP routing (routes-rex.ts) lives inside web-dashboard rather than mcp-route-layer, splitting MCP protocol handling across two zones — moving routes-rex.ts into mcp-route-layer would unify the MCP boundary and reduce web-dashboard's surface area.
- monorepo-maintenance-scripts enforces gateway discipline for hench and web but has no equivalent check for the rex or sourcevision packages, leaving those gateways unguarded by static script validation.
- The orchestration zone has no import edges to any other zone, meaning integration contract violations (e.g. changed CLI flags or output formats in rex/sourcevision/hench) will only manifest at runtime, not at build or typecheck time — consider adding a contract-test layer in e2e that validates CLI I/O contracts across package boundaries.
- Rex-runtime-state is a shared mutable filesystem interface consumed by rex (writer), hench (reader/writer via rex-gateway), and web-server (reader via MCP) — this hidden fan-in dependency is invisible to import-graph tooling and creates a schema coupling risk across three tiers of the hierarchy.

