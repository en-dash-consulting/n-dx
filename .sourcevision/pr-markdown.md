## Summary

**Branch:** `sourcevision0304`
**Base:** `main`
**Completed items:** 73

| Epic | Completed |
|------|-----------|
| Rex Token Usage & LLM Utilization UX Overhaul | 4 |
| Web UI Design and User Experience Enhancement | 4 |
| Rex UI Task Management Enhancement | 3 |
| Duplicate-aware Proposal Override for rex add | 3 |
| Rex UI Task Management Enhancement | 3 |
| SourceVision UI Import Graph Enhancement | 3 |
| PR Build Pipeline and Code Quality Automation | 2 |
| Rex UI Task Management Enhancement | 3 |
| Rex UI Task Management Enhancement | 3 |
| Rex UI Task Management Enhancement | 2 |
| Analyze pipeline improvements | 2 |

## ⚠️ Breaking Changes

- **Address suggestion issues (18 findings)**
  - Verify that packages/hench/src/public.ts exists and exports the complete public API surface — if it is missing, hench is the only package breaking the public.ts convention stated in CLAUDE.md, creating an undocumented exception in the five-package pattern.
- Add zone coupling and cohesion threshold assertions to ci.js — for example, fail CI if any non-asset zone's coupling exceeds 0.25 or cohesion drops below 0.5 — so architectural degradation is caught automatically rather than requiring manual analysis runs.
- Adopt a policy of excluding .gitkeep files from zone membership in the sourcevision inventory phase. These files provide no semantic signal and distort cohesion/coupling scores most severely in small, low-cohesion zones — exactly the zones where accurate metrics matter most for architectural decision-making.
- Establish and document an explicit zone naming convention distinguishing source zones from test zones: zones containing production source files should never carry a '-tests' suffix regardless of whether they also contain test files. The single violation ('prd-tree-lifecycle-tests' containing 2 production components) is low-cost to fix now but will compound as contributors use the zone name as a template for future lifecycle component zones.
- The 'web' zone (15 files, cohesion 0.86) is the second-lowest cohesion zone among actively-imported zones in the web layer and receives imports from both web-viewer and web-integration simultaneously — the same dual-consumer blast-radius risk profile as the message zone. Unlike message, it has received no explicit review or documentation of what belongs there. Define and document the web zone's content contract before it accumulates heterogeneous content that degrades its cohesion further.
- The import graph alias 'message' and zone metadata ID 'viewer-message-flow-control' refer to the same zone but use different identifiers. Any cross-source analysis (health dashboards, import attribution, lint rules) that joins these two data sources by ID will silently produce incorrect results. This is a data integrity defect: assign a single canonical ID and regenerate all output files consistently.
- sourcevision emits abbreviated zone IDs in imports.json that do not match canonical zone IDs in zone metadata for at least two zones (dom-performance-monitoring → 'dom', viewer-message-flow-control → 'message'). Both follow the same first-word-segment truncation pattern, confirming a systemic defect. Any automated pipeline joining these two data sources by zone ID silently drops all import edges for both affected zones. Fix by enforcing that sourcevision uses the identical canonical zone ID string in every output file (zones.json, imports.json, CONTEXT.md, per-zone summary files).
- 2 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:cli-e2e-test-suite, packages-rex:token-usage-analytics — mandatory refactoring recommended before further development
- Consolidate node-culler.ts and request-dedup.ts into a formal packages/web/src/shared/ directory with an index.ts barrel — this removes algorithmic zone fragility, makes the shared surface explicit, and prevents future utilities from being scattered across viewer subdirectories.
- 'cli-dev.test.js' covers a command not listed in CLAUDE.md. Verify whether 'ndx dev' is a real, documented command or a removed/renamed one. If removed, delete the test to avoid false CI confidence; if undocumented, add it to CLAUDE.md.
- The zone ID appears as 'dom' in the cross-zone import graph — the second confirmed instance of the same zone ID truncation bug already identified for viewer-message-flow-control. Both affected zones have active cross-zone import edges, meaning joins between imports.json and zone metadata silently drop their edges. This confirms the bug is systemic and must be fixed in sourcevision's import graph emission, not patched per-zone.
- Rename zone to 'prd-tree-lifecycle' to eliminate the false '-tests' suffix signal. The current name implies a test-only zone but it contains production components; the mislabeling will cause contributor confusion and may break tooling that distinguishes source zones from test zones by name suffix. Every other '-tests'-suffixed zone in the codebase contains only test files.
- Add integration tests for the orchestration scripts that verify the correct CLI commands are constructed and invoked — child-process delegation logic is currently untested and regressions would be invisible to the per-package test suites.
- Define and implement a maximum-entry or size-based rotation policy for .rex/execution-log.jsonl to prevent unbounded growth in long-running projects.
- FRAGILE ZONE: viewer-message-flow-control has both the lowest cohesion (0.45) and coupling approaching the warning threshold (0.55) simultaneously. This combination — structurally weak internally, heavily consumed externally — makes it the single highest-risk zone for cascading breakage. Prioritize splitting or stabilizing this zone before adding new consumers.
- Three-way naming conflict: source files use 'message-' prefix, zone ID is 'viewer-message-flow-control', import graph alias is 'message'. Establish a single canonical name (recommend 'messaging-primitives') and propagate it to all three: filenames, zone ID in zones.json, and the import graph key in imports.json.
- Zone "CLI End-to-End Test Suite" (packages-rex:cli-e2e-test-suite) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- Zone "Token Usage Analytics" (packages-rex:token-usage-analytics) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- **Smart Add Command Regression Fix**
  The Rex Dashboard Smart Add input throws 'Unknown command: smart-add' once the character count threshold is met. The web UI is invoking a rex CLI subcommand name that no longer matches the registered command, breaking the real-time proposal flow entirely.

## Major Changes

- **Fix zone ID truncation in zoneContentHashes** [critical]
  Remap zoneContentHashes keys after AI enrichment renames zone IDs. Currently the keys use pre-enrichment IDs (e.g. "dom", "message") while zone.id values use post-enrichment IDs (e.g. "dom-performance-monitoring", "viewer-message-flow-control"). This causes silent data join failures.
- **Address anti-pattern issues (10 findings)** [critical]
  - Both messaging zones contain .gitkeep placeholder files that are counted as zone members. Since these zones are the lowest-cohesion zones in the codebase and the primary architectural risk surface, metric distortion from non-functional files is highest-impact here. All .gitkeep files should be excluded from zone membership calculations in the sourcevision inventory phase to ensure health scores reflect only meaningful source and test files.
- Five circular dependency chains are reported in imports.json but no zone insight identifies their location. If any cycle crosses zone boundaries (e.g., web-viewer ↔ web-integration or web-integration ↔ message), it would represent an architectural violation of the strict partial order observed in the zone graph. These cycles must be localized and classified before the 'no circular dependencies among analyzed zones' conclusion can be treated as a full guarantee.
- The composed messaging stack (viewer-message-flow-control → viewer-call-rate-limiter → web-viewer) has no integration or e2e test that validates the full composition under real conditions. Each zone has unit tests, but composed behavior — including that viewer-call-rate-limiter correctly throttles viewer-message-flow-control primitives and that web-viewer does not bypass the rate-limiter — is never asserted. A single integration test that instantiates all three layers together would close this gap.
- The gateway pattern is applied inconsistently: hench and web-server enforce explicit gateway modules for all cross-package imports, but the intra-web layer (web-viewer consuming message, web, web-integration) has no equivalent gateway discipline. The pattern's benefits are present at tier boundaries but absent at zone boundaries within the web package, creating a two-tier enforcement gap.
- The server/client boundary within packages/web (src/server/ vs src/viewer/) has no machine-enforced import restriction. The gateway pattern prevents cross-package imports, but an accidental import from src/viewer/ into src/server/ (or vice versa) would not be caught by any existing lint, build, or zone-coupling check. This boundary should be enforced via eslint-plugin-import boundaries or TypeScript project references to match the rigor applied to cross-package imports.
- Zone ID 'viewer-message-flow-control' in zone metadata does not match the ID 'message' used in the cross-zone import graph. Any tooling that joins these two data sources by zone ID will silently produce incorrect attribution. This should be treated as a data integrity defect in sourcevision output generation, requiring a single canonical ID to be used consistently across all output files (zones.json, imports.json, CONTEXT.md).
- God function: handleHenchRoute in packages/web/src/server/routes-hench.ts calls 59 unique functions — consider decomposing into smaller, focused functions
- The message zone has no formal public interface file (e.g., types.ts or protocol.ts) that declares the contract between its 5 files and its 6 consumers. Its low cohesion (0.45) combined with high inbound traffic means consumers are importing individual implementation files rather than a stable surface, making the zone brittle to internal reorganization.
- web-integration's name implies it is an adapter between web-viewer and the lower infrastructure zones (message, web), but web-viewer imports message and web directly rather than through web-integration. web-integration is therefore a parallel consumer, not a facade — its architectural role is misleading and contributors may add redundant integration logic to both web-integration and web-viewer independently.
- web-viewer has no internal gateway consolidating its cross-zone imports, unlike hench (rex-gateway.ts) and web server (rex-gateway.ts, domain-gateway.ts). With 4+ cross-zone import paths, scattered call-site imports mean any upstream API change (message, web-integration, web) requires a grep across 329 files to find all affected sites rather than a single gateway edit.
- **Address suggestion issues (3 findings)** [critical]
  - 2 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:e2e, packages-rex:usage — mandatory refactoring recommended before further development
- Zone "E2e" (packages-rex:e2e) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- Zone "Usage" (packages-rex:usage) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- **Web UI Design and User Experience Enhancement**
- **Rex UI Task Management Enhancement**
- **Duplicate-aware Proposal Override for rex add**
- **Rex UI Task Management Enhancement**
- **SourceVision UI Import Graph Enhancement**
- **PR Build Pipeline and Code Quality Automation**
- **Rex UI Task Management Enhancement**
- **Identify and fix smart-add command name mismatch between web UI and rex CLI** [critical]
  The Rex Dashboard Smart Add box triggers an API call to the rex CLI using the subcommand 'smart-add', but the CLI no longer registers that name — likely renamed or restructured during a prior refactor. Trace the full call path from the web UI input handler through the web server API route to the rex CLI invocation, identify the correct current command name (e.g. 'add --smart' or similar), and update the web server route or API client to use the correct invocation. Verify the fix does not break the CLI's own smart-add entry point if it is invoked directly.
- **Address suggestion issues (1 findings)** [critical]
  - Zone "Schema Validation" (packages-rex:schema-validation) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- **Rex UI Task Management Enhancement**
- **Fix Smart Add CLI command argument construction in Rex Dashboard** [critical]
  The Rex Dashboard Smart Add feature builds a shell command like `rex add --format=json <description>` before dispatching it to the CLI. A regression is causing the description argument to be concatenated with unrelated UI state (e.g. the current search query or last-focused task title), producing a malformed command such as `rex add --format=json limit Tag selection options in the rex task UI search area`. Trace the command-builder code path, identify the source of the stale string injection, and fix the argument assembly so only the user-entered description is forwarded.
- **Rex UI Task Management Enhancement**
- **Analyze pipeline improvements**

## Completed Work

### Analyze pipeline improvements

**Hide completed items by default in status views**
- Suppress deleted items from rex status CLI output by default

- Hide completed items by default in status views *(feature)*

### Duplicate-aware Proposal Override for rex add

**Orphaned Parent Cleanup After Smart-Add Merge**
- Fix orphaned epic creation in smart-add merge path
  Trace the merge execution path in the smart-add pipeline to identify where the proposed parent epic is instantiated before merge resolution completes. The bug produces an empty or single-child epic that is structurally disconnected after the merge target absorbs the child item. The fix should defer or suppress parent creation when a merge is confirmed, or clean up any empty containers after the merge operation settles. Verify the fix against both cross-level and same-level merge scenarios.
  - Performing a smart-add merge does not create a new top-level epic that has no children after the operation completes
  - If a parent epic was legitimately created as part of the merge (e.g. to group merged children), it is retained with its children intact
  - Running `rex validate` after a merge produces no orphaned-node errors
  - Existing merge behavior for same-level and cross-level matches is unchanged
- Add regression tests for orphaned parent scenarios in smart-add merge

- Orphaned Parent Cleanup After Smart-Add Merge *(feature)*
  When the smart-add merge path is applied, the proposed parent epic container can be written to the PRD before the merge target is resolved, leaving it as an empty or childless node. This feature covers the fix and regression coverage.

### PR Build Pipeline and Code Quality Automation

**GitHub Actions CI Pipeline**
- Create GitHub Actions workflow replacing bitbucket-pipelines.yml
  Write a .github/workflows/ci.yml that replicates the PR validation pipeline currently defined in bitbucket-pipelines.yml. The workflow should trigger on pull_request and push-to-main events, install pnpm and Node dependencies, run the build, typecheck, and PRD validation steps (pnpm build, pnpm typecheck, node ci.js), and report failures clearly. The existing bitbucket-pipelines.yml should be removed once the GitHub Actions workflow is confirmed working.
  - .github/workflows/ci.yml exists and triggers on pull_request (all branches) and push to main
  - Workflow installs correct Node version and pnpm, restores node_modules via cache
  - pnpm build runs across all packages with no skipped packages
  - pnpm typecheck runs across all packages and fails the job on type errors
  - node ci.js (or ndx ci .) runs and fails the job when PRD validation fails
  - bitbucket-pipelines.yml is removed from the repository
  - A passing workflow run is confirmed in GitHub Actions UI

- GitHub Actions CI Pipeline *(feature)*
  Replace the existing Bitbucket Pipelines configuration with an equivalent GitHub Actions workflow that runs build, typecheck, and PRD validation on pull requests and pushes to main.

### Rex Token Usage & LLM Utilization UX Overhaul

**Task-Level Usage Visibility and Budget Context**
- Add 'showTokenBudget' feature toggle with default-off configuration
  Introduce a new feature toggle key (e.g. `showTokenBudget`) in the n-dx feature toggle system. It must default to false so token budget UI is hidden out-of-the-box. The toggle should be accessible via `ndx config` and the existing feature toggle configuration section in the web UI. Document the toggle in CLI help.
  - A `showTokenBudget` toggle key exists in the feature toggle schema and defaults to false
  - `ndx config` can read and write the toggle
  - The web UI feature toggle configuration section lists and toggles `showTokenBudget`
  - CLI help text references the new toggle
- Conditionally hide token budget in task line items and detail panel based on toggle
  In the Rex task list and detail side panel, gate all token-budget-specific UI (budget bar, budget percentage chip, budget limit label) behind the `showTokenBudget` feature toggle. When the toggle is off these elements must not render at all — not just hidden via CSS. Token usage counts (already present) are unaffected.
  - When `showTokenBudget` is false, no budget bar, budget percentage, or budget limit label appears on task line items
  - When `showTokenBudget` is false, no budget-related fields appear in the task detail side panel
  - When `showTokenBudget` is true, budget UI renders as before
  - Toggling the setting live (without page reload) updates the display
- Render non-zero token usage as a compact badge on task line items
  On every Rex task line item, display a small token usage badge (e.g. '1.2k tokens') when the task has accumulated non-zero usage. The badge must appear regardless of the `showTokenBudget` toggle — it is always visible when there is usage to show. Use a neutral chip style distinct from status badges. Zero-usage tasks show no badge.
  - Tasks with non-zero token usage display a compact usage badge on the line item
  - Tasks with zero token usage show no badge
  - The badge renders when `showTokenBudget` is false
  - The badge renders when `showTokenBudget` is true
  - Badge value is human-readable (e.g. '1.2k', '45k') with a token icon or label
- Improve hench run association and token burn display in task detail panel

### Rex UI Task Management Enhancement

**Ctrl/Shift Multi-Select for Task Items**
- Implement ctrl/shift multi-select interaction on Rex task list items

**Rex Task Search**
- Implement task search input and filtering engine in Rex UI
  Add a search input to the Rex dashboard that filters the visible PRD tree in real time. The filtering engine should match against task/feature/epic titles and descriptions using case-insensitive substring matching, keeping matching ancestors visible to preserve tree context. Results should highlight matched text and auto-expand collapsed sections that contain matches.
  - Search input is visible and focused on keyboard shortcut (e.g. Ctrl+F / Cmd+F or a dedicated keybinding)
  - Typing in the search input filters the PRD tree to show only items whose title or description contains the query (case-insensitive)
  - Ancestor nodes (epics, features) of matching tasks remain visible to provide tree context
  - Matched text is visually highlighted within each result
  - Sections containing matches are automatically expanded
  - Clearing the search input restores the full unfiltered tree
  - Search state is not persisted across page reloads
- Extend Rex task search with tag and status facets
- Limit tag filter options in Rex task search to tags present in the current PRD

**Smart Add Command Construction and Submission UX Fix**
- 🔶 **Fix Smart Add CLI command argument construction in Rex Dashboard**
  The Rex Dashboard Smart Add feature builds a shell command like `rex add --format=json <description>` before dispatching it to the CLI. A regression is causing the description argument to be concatenated with unrelated UI state (e.g. the current search query or last-focused task title), producing a malformed command such as `rex add --format=json limit Tag selection options in the rex task UI search area`. Trace the command-builder code path, identify the source of the stale string injection, and fix the argument assembly so only the user-entered description is forwarded.
  - Submitting a Smart Add description dispatches exactly `rex add --format=json <user-description>` with no extra text appended
  - The error 'Command failed: … add --format=json <unrelated-text>' no longer appears in the dashboard for any input
  - Verified by submitting a short description while a different task or search term is visible on screen — the dispatched command contains only the typed description
  - Existing Smart Add integration test suite passes without modification
- Prevent Smart Add form auto-submission and require explicit user action
  The Smart Add input form in the Rex Dashboard currently submits automatically — either on each keystroke (reactive binding) or on Enter key press — before the user has finished composing their description. This makes it impossible to type multi-word or multi-clause ideas without triggering a premature submission. The form should only submit when the user explicitly clicks the Submit button (or equivalent deliberate action). Debouncing alone is insufficient; the trigger must be user-initiated.
  - Typing any text into the Smart Add input does not trigger proposal generation or CLI dispatch
  - Pressing Enter while focused in the Smart Add input does not submit the form
  - The form submits only when the user activates the designated Submit/Generate button
  - A user can type, pause, edit, and resume typing before submitting without any interim API calls or errors
  - Submission button is visually distinct and reachable via keyboard (Tab + Enter/Space)

**Smart Add Command Regression Fix**
- 🔶 **Identify and fix smart-add command name mismatch between web UI and rex CLI**
  The Rex Dashboard Smart Add box triggers an API call to the rex CLI using the subcommand 'smart-add', but the CLI no longer registers that name — likely renamed or restructured during a prior refactor. Trace the full call path from the web UI input handler through the web server API route to the rex CLI invocation, identify the correct current command name (e.g. 'add --smart' or similar), and update the web server route or API client to use the correct invocation. Verify the fix does not break the CLI's own smart-add entry point if it is invoked directly.
  - Typing in the Smart Add box in the Rex Dashboard no longer produces an 'Unknown command' error at any character count
  - Proposal generation triggers successfully and returns results in the Smart Add panel
  - The rex CLI 'rex --help' output confirms the invoked subcommand or flag exists
  - No regression in the CLI smart-add workflow when invoked directly from the terminal
  - Web server API route for smart-add returns a 200-range response with proposal data
- Add integration test covering Smart Add web-to-CLI command dispatch
  There is currently no test that exercises the full web UI → web server → rex CLI invocation path for the smart-add feature, which allowed a command name regression to ship undetected. Add an integration test that confirms the web server's smart-add endpoint constructs and dispatches the correct CLI command, and that a well-formed response is returned when the rex package handles the request.
  - Integration test exists that mounts the web server smart-add route and asserts the correct rex command is invoked
  - Test fails when the command name is set to 'smart-add' (reproducing the bug) and passes with the correct command
  - Test is added to the standard CI test suite and runs without additional setup
  - Test covers at least one happy-path proposal response and one error case (invalid input)

- ⚠️ **Smart Add Command Regression Fix** *(feature)*
  The Rex Dashboard Smart Add input throws 'Unknown command: smart-add' once the character count threshold is met. The web UI is invoking a rex CLI subcommand name that no longer matches the registered command, breaking the real-time proposal flow entirely.
- Ctrl/Shift Multi-Select for Task Items *(feature)*
  Replace checkbox-based selection in the Rex tasks UI with keyboard-modifier multi-select (ctrl+click for toggle, shift+click for range selection), matching the interaction model familiar from file explorers and list UIs.
- Ability to edit epic/feature/task details in the side panel *(feature)*
- Rex Task Search *(feature)*
  Add search functionality to the Rex tasks web UI so users can quickly locate tasks, epics, and features by title, description, tags, or status without manually scanning the full PRD tree.
- Smart Add Command Construction and Submission UX Fix *(feature)*
  Two related regressions in the Rex Dashboard Smart Add form: (1) the CLI command is being built incorrectly, appending stale or unrelated text from the UI (e.g. a previous task title) to the `add` subcommand arguments, causing a command-not-found failure; (2) the form auto-submits on every keystroke or Enter press rather than waiting for the user to finish composing their input.
- Rex Task Search *(feature)*

### SourceVision UI Import Graph Enhancement

**Zone Slideout Interaction Regression Fix**
- Restore zone node click and info button routing to slideout panel
  Clicking a zone node or its info button currently collapses the node instead of opening the detail slideout panel. Audit the click event handlers on zone graph nodes and the info button, identify where the event is being consumed or incorrectly routed, and restore the behavior so node clicks open the slideout. The 'Load more' action should similarly not collapse the node.
  - Clicking a zone node opens the detail slideout panel instead of collapsing the node
  - Clicking the info button on a zone node opens the detail slideout panel
  - The 'Load more' action expands data inline without collapsing the node
  - Collapsing a node only occurs when explicitly triggered via a dedicated collapse affordance
  - Slideout opens with correct zone data matching the clicked node
- Improve info button visual affordance on zone nodes

- Zone Slideout Interaction Regression Fix *(feature)*
  The SourceVision Zones graph no longer opens the detail slideout panel when clicking zone nodes or the info button — instead, clicks collapse the node. The info button also lacks visual affordance indicating it reveals more information. This feature restores correct click behavior and improves the info button's discoverability.

### Web UI Design and User Experience Enhancement

**FAQ FAB Placement and Role Separation**
- Relocate global FAQ FAB to bottom-left toolbar beside theme switcher

**Sidebar Active State on Initial Load**
- Sync sidebar active state with current route on initial page load

- FAQ FAB Placement and Role Separation *(feature)*
  Clarify the dual-FAB FAQ pattern by anchoring the global FAQ FAB in the bottom-left toolbar alongside the theme switcher, while leaving the page-specific FAQ FAB in its existing top-right position. This gives each button a distinct visual location that communicates its scope to the user.
- Sidebar Active State on Initial Load *(feature)*
  Ensure the sidebar navigation correctly reflects the active page when the app first loads, including direct URL access and page refresh scenarios.

### (Ungrouped)

**Address anti-pattern issues (10 findings)**
- Exclude .gitkeep files from sourcevision inventory
  Add .gitkeep to skip patterns in sourcevision inventory analyzer so placeholder files don't distort zone membership and cohesion metrics.
- Decompose handleHenchRoute god function
  Break handleHenchRoute (59 unique function calls) into focused sub-handlers organized by resource type (runs, memory, metrics, throttle, templates, config, execute).
- Create messaging zone public interface barrel
  Add an index.ts barrel file for packages/web/src/viewer/messaging/ that declares the public API. Update consumers to import from the barrel instead of individual implementation files.
- Create web-viewer cross-zone gateway modules
  Create gateway modules for web-viewer's cross-zone imports (messaging, performance, polling) following the same pattern as hench/rex-gateway.ts and web-server gateways. Consolidate scattered cross-zone imports.
- Add server/client boundary enforcement via ESLint
- Localize and classify circular dependency chains
- Add messaging stack integration test
- Document web-integration zone architectural role

**Address observation issues (3 findings)**
- Break rex analyze circular dependency (reason.ts ↔ extract.ts)
  reason.ts dynamically imports extract.ts (lines 1224, 2050, 2061), and extract.ts statically imports utilities from reason.ts (detectFileFormat, spawnClaude, extractJson, etc.). file-validation.ts also imports FileFormat type from reason.ts. Extract shared utilities (detectFileFormat, extractJson, repairTruncatedJson, emptyAnalyzeTokenUsage, accumulateTokenUsage, PRD_SCHEMA, TASK_QUALITY_RULES, OUTPUT_INSTRUCTION, FileFormat type) into a new shared module that both reason.ts and extract.ts can import from without creating a cycle.
  - No circular dependency between reason.ts, extract.ts, and file-validation.ts
  - All existing tests pass
  - No changes to public API
- Break sourcevision circular dependency (enrich.ts ↔ zones.ts)
  enrich.ts imports computeGlobalContentHash from zones.ts, while zones.ts imports enrichZonesWithAI and enrichZonesPerZone from enrich.ts. Move computeGlobalContentHash to a shared utility module or pass it as a dependency to break the cycle.
  - No circular dependency between enrich.ts and zones.ts
  - All existing tests pass
  - No changes to public API
- Document message zone architecture and rex schema fan-in hotspot

**Address suggestion issues (18 findings)**
- 🔶 **Fix zone ID truncation in zoneContentHashes**
  Remap zoneContentHashes keys after AI enrichment renames zone IDs. Currently the keys use pre-enrichment IDs (e.g. "dom", "message") while zone.id values use post-enrichment IDs (e.g. "dom-performance-monitoring", "viewer-message-flow-control"). This causes silent data join failures.
- Add CI zone health threshold assertions
  Add a new CI step to ci.js that reads zones.json and fails if any non-asset zone exceeds coupling 0.25 or drops below cohesion 0.5. Report violating zones in the CI output.
- Document ndx dev command in CLAUDE.md
- Consolidate shared utilities into packages/web/src/shared/
- Implement execution log rotation for .rex/execution-log.jsonl
- Add orchestration script integration tests
- Zone naming conventions and renaming

- ⚠️ **Address suggestion issues (18 findings)** *(feature)*
  - Verify that packages/hench/src/public.ts exists and exports the complete public API surface — if it is missing, hench is the only package breaking the public.ts convention stated in CLAUDE.md, creating an undocumented exception in the five-package pattern.
- Add zone coupling and cohesion threshold assertions to ci.js — for example, fail CI if any non-asset zone's coupling exceeds 0.25 or cohesion drops below 0.5 — so architectural degradation is caught automatically rather than requiring manual analysis runs.
- Adopt a policy of excluding .gitkeep files from zone membership in the sourcevision inventory phase. These files provide no semantic signal and distort cohesion/coupling scores most severely in small, low-cohesion zones — exactly the zones where accurate metrics matter most for architectural decision-making.
- Establish and document an explicit zone naming convention distinguishing source zones from test zones: zones containing production source files should never carry a '-tests' suffix regardless of whether they also contain test files. The single violation ('prd-tree-lifecycle-tests' containing 2 production components) is low-cost to fix now but will compound as contributors use the zone name as a template for future lifecycle component zones.
- The 'web' zone (15 files, cohesion 0.86) is the second-lowest cohesion zone among actively-imported zones in the web layer and receives imports from both web-viewer and web-integration simultaneously — the same dual-consumer blast-radius risk profile as the message zone. Unlike message, it has received no explicit review or documentation of what belongs there. Define and document the web zone's content contract before it accumulates heterogeneous content that degrades its cohesion further.
- The import graph alias 'message' and zone metadata ID 'viewer-message-flow-control' refer to the same zone but use different identifiers. Any cross-source analysis (health dashboards, import attribution, lint rules) that joins these two data sources by ID will silently produce incorrect results. This is a data integrity defect: assign a single canonical ID and regenerate all output files consistently.
- sourcevision emits abbreviated zone IDs in imports.json that do not match canonical zone IDs in zone metadata for at least two zones (dom-performance-monitoring → 'dom', viewer-message-flow-control → 'message'). Both follow the same first-word-segment truncation pattern, confirming a systemic defect. Any automated pipeline joining these two data sources by zone ID silently drops all import edges for both affected zones. Fix by enforcing that sourcevision uses the identical canonical zone ID string in every output file (zones.json, imports.json, CONTEXT.md, per-zone summary files).
- 2 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:cli-e2e-test-suite, packages-rex:token-usage-analytics — mandatory refactoring recommended before further development
- Consolidate node-culler.ts and request-dedup.ts into a formal packages/web/src/shared/ directory with an index.ts barrel — this removes algorithmic zone fragility, makes the shared surface explicit, and prevents future utilities from being scattered across viewer subdirectories.
- 'cli-dev.test.js' covers a command not listed in CLAUDE.md. Verify whether 'ndx dev' is a real, documented command or a removed/renamed one. If removed, delete the test to avoid false CI confidence; if undocumented, add it to CLAUDE.md.
- The zone ID appears as 'dom' in the cross-zone import graph — the second confirmed instance of the same zone ID truncation bug already identified for viewer-message-flow-control. Both affected zones have active cross-zone import edges, meaning joins between imports.json and zone metadata silently drop their edges. This confirms the bug is systemic and must be fixed in sourcevision's import graph emission, not patched per-zone.
- Rename zone to 'prd-tree-lifecycle' to eliminate the false '-tests' suffix signal. The current name implies a test-only zone but it contains production components; the mislabeling will cause contributor confusion and may break tooling that distinguishes source zones from test zones by name suffix. Every other '-tests'-suffixed zone in the codebase contains only test files.
- Add integration tests for the orchestration scripts that verify the correct CLI commands are constructed and invoked — child-process delegation logic is currently untested and regressions would be invisible to the per-package test suites.
- Define and implement a maximum-entry or size-based rotation policy for .rex/execution-log.jsonl to prevent unbounded growth in long-running projects.
- FRAGILE ZONE: viewer-message-flow-control has both the lowest cohesion (0.45) and coupling approaching the warning threshold (0.55) simultaneously. This combination — structurally weak internally, heavily consumed externally — makes it the single highest-risk zone for cascading breakage. Prioritize splitting or stabilizing this zone before adding new consumers.
- Three-way naming conflict: source files use 'message-' prefix, zone ID is 'viewer-message-flow-control', import graph alias is 'message'. Establish a single canonical name (recommend 'messaging-primitives') and propagate it to all three: filenames, zone ID in zones.json, and the import graph key in imports.json.
- Zone "CLI End-to-End Test Suite" (packages-rex:cli-e2e-test-suite) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- Zone "Token Usage Analytics" (packages-rex:token-usage-analytics) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- 🔶 **Address anti-pattern issues (10 findings)** *(feature)*
  - Both messaging zones contain .gitkeep placeholder files that are counted as zone members. Since these zones are the lowest-cohesion zones in the codebase and the primary architectural risk surface, metric distortion from non-functional files is highest-impact here. All .gitkeep files should be excluded from zone membership calculations in the sourcevision inventory phase to ensure health scores reflect only meaningful source and test files.
- Five circular dependency chains are reported in imports.json but no zone insight identifies their location. If any cycle crosses zone boundaries (e.g., web-viewer ↔ web-integration or web-integration ↔ message), it would represent an architectural violation of the strict partial order observed in the zone graph. These cycles must be localized and classified before the 'no circular dependencies among analyzed zones' conclusion can be treated as a full guarantee.
- The composed messaging stack (viewer-message-flow-control → viewer-call-rate-limiter → web-viewer) has no integration or e2e test that validates the full composition under real conditions. Each zone has unit tests, but composed behavior — including that viewer-call-rate-limiter correctly throttles viewer-message-flow-control primitives and that web-viewer does not bypass the rate-limiter — is never asserted. A single integration test that instantiates all three layers together would close this gap.
- The gateway pattern is applied inconsistently: hench and web-server enforce explicit gateway modules for all cross-package imports, but the intra-web layer (web-viewer consuming message, web, web-integration) has no equivalent gateway discipline. The pattern's benefits are present at tier boundaries but absent at zone boundaries within the web package, creating a two-tier enforcement gap.
- The server/client boundary within packages/web (src/server/ vs src/viewer/) has no machine-enforced import restriction. The gateway pattern prevents cross-package imports, but an accidental import from src/viewer/ into src/server/ (or vice versa) would not be caught by any existing lint, build, or zone-coupling check. This boundary should be enforced via eslint-plugin-import boundaries or TypeScript project references to match the rigor applied to cross-package imports.
- Zone ID 'viewer-message-flow-control' in zone metadata does not match the ID 'message' used in the cross-zone import graph. Any tooling that joins these two data sources by zone ID will silently produce incorrect attribution. This should be treated as a data integrity defect in sourcevision output generation, requiring a single canonical ID to be used consistently across all output files (zones.json, imports.json, CONTEXT.md).
- God function: handleHenchRoute in packages/web/src/server/routes-hench.ts calls 59 unique functions — consider decomposing into smaller, focused functions
- The message zone has no formal public interface file (e.g., types.ts or protocol.ts) that declares the contract between its 5 files and its 6 consumers. Its low cohesion (0.45) combined with high inbound traffic means consumers are importing individual implementation files rather than a stable surface, making the zone brittle to internal reorganization.
- web-integration's name implies it is an adapter between web-viewer and the lower infrastructure zones (message, web), but web-viewer imports message and web directly rather than through web-integration. web-integration is therefore a parallel consumer, not a facade — its architectural role is misleading and contributors may add redundant integration logic to both web-integration and web-viewer independently.
- web-viewer has no internal gateway consolidating its cross-zone imports, unlike hench (rex-gateway.ts) and web server (rex-gateway.ts, domain-gateway.ts). With 4+ cross-zone import paths, scattered call-site imports mean any upstream API change (message, web-integration, web) requires a grep across 329 files to find all affected sites rather than a single gateway edit.
- 🔶 **Address suggestion issues (3 findings)** *(feature)*
  - 2 zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6): packages-rex:e2e, packages-rex:usage — mandatory refactoring recommended before further development
- Zone "E2e" (packages-rex:e2e) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- Zone "Usage" (packages-rex:usage) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- 🔶 **Web UI Design and User Experience Enhancement** *(epic)*
- 🔶 **Rex UI Task Management Enhancement** *(epic)*
- 🔶 **Duplicate-aware Proposal Override for rex add** *(epic)*
- 🔶 **Rex UI Task Management Enhancement** *(epic)*
- 🔶 **SourceVision UI Import Graph Enhancement** *(epic)*
- 🔶 **PR Build Pipeline and Code Quality Automation** *(epic)*
- 🔶 **Rex UI Task Management Enhancement** *(epic)*
- 🔶 **Address suggestion issues (1 findings)** *(feature)*
  - Zone "Schema Validation" (packages-rex:schema-validation) has catastrophic risk (score: 0.71, cohesion: 0.29, coupling: 0.71) — requires immediate architectural intervention
- 🔶 **Rex UI Task Management Enhancement** *(epic)*
- 🔶 **Rex UI Task Management Enhancement** *(epic)*
- 🔶 **Analyze pipeline improvements** *(epic)*
- Address observation issues (3 findings) *(feature)*
  - 5 circular dependency chains detected — see imports.json for details
- The message zone's low cohesion (0.45) combined with being the most-imported zone in the web layer suggests it has grown into a catch-all communication module; splitting it into typed message definitions and transport utilities would improve cohesion and make the import graph more precise.
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- Address pattern issues (2 findings) *(feature)*
  - The entire codebase has coupling > 0 only in the web messaging stack (3 zones); all other zones are at coupling 0 — this concentration means the messaging layer is the single point of architectural debt and deserves priority refactoring attention before it accretes further consumers
- The web layer exhibits a hub-and-spoke topology with web-viewer (329 files) as the hub: it imports from message, web-integration, and web-package-scaffolding while being imported by dom. All other zones are spokes or isolated. This concentration of import edges in one zone is a scaling risk — as web-viewer grows, its import surface grows proportionally with no natural decomposition boundary.
- Address relationship issues (3 findings) *(feature)*
  - web-viewer bypasses web-integration for 4 of its 6 message-zone imports, importing message directly rather than through the integration layer. This partial bypass means web-integration is not enforcing a stable interface over message for web-viewer, leaving web-viewer exposed to message internals directly.
- web-viewer simultaneously imports from web, web-integration, viewer-call-rate-limiter, and viewer-message-flow-control — it is the hub of all non-zero coupling in the web layer; if web-viewer grows further, these four inbound dependency paths will become increasingly difficult to untangle
- web-integration acts as an implicit middleware hub: it imports from both message and web while being imported by web-viewer. This three-way relay role is not documented and risks becoming a catch-all as the codebase grows. Define a clear responsibility boundary for this zone.
- Address observation issues (3 findings) *(feature)*
  - 1 circular dependency chain detected — see imports.json for details
- Bidirectional coupling: "web" ↔ "web-viewer" (4+2 crossings) — consider extracting shared interface
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- Address pattern issues (2 findings) *(feature)*
  - Findings 0 and 11 are independently generated by different analysis methods and both identify the same unresolved circular dependency as a real structural issue. The specific actionable gap is file-pair localization: neither finding names the exact files forming the cycle. Run a targeted traversal of imports.json filtering for cycle edges where both endpoints fall within the web-viewer zone (338-file interior) to identify the specific pair before attempting a fix. Until localized, the build-correctness risk flagged in finding 11 cannot be resolved.
- Findings 1, web-server zone finding 0, and global finding 5 converge on one root cause: the web package zone structure was grown incrementally without a consistent model. The three concrete symptoms are bidirectional coupling between web-dashboard-application and web-package-root (2+4 crossings), a 4-file web-server satellite with 0.63 cohesion and 0.38 coupling that imports bidirectionally with web-viewer (2+2 crossings), and zone names that mix 'web-viewer', 'panel', 'dom', 'logo' prefixes within a single package. These are three manifestations of the same structural deficit, not three independent problems. Addressing the naming convention (finding 5) and the satellite merge (web-server finding 0) would simultaneously improve the coupling metric tracked in finding 1.
- Address anti-pattern issues (1 findings) *(feature)*
  - God function: GraphRenderer.constructor in packages/web/src/viewer/graph/renderer.ts calls 49 unique functions — consider decomposing into smaller, focused functions
- Fix cross-level matching in smart-add duplicate merge
  The smart-add duplicate detection (`matchProposalNodeToPRD` in `smart-add-duplicates.ts`) walks the entire PRD tree and scores every item against each proposal node with no level filtering. A proposed epic can match an existing task, a proposed feature can match an existing epic, etc. This causes two failure modes:

1. **Crash + partial state** — A proposed epic matches an existing task/feature. The merge target ID is used as `epicId` in `acceptProposals`. When it tries to add a new feature under this "epic" (actually a task), `insertChild` rejects the hierarchy mismatch (`tree.ts:65`), `addItem` throws (`file-adapter.ts:50`), and the loop aborts mid-way. Items added before the crash are already persisted → partial, broken PRD.

2. **Silent structural corruption** — A proposed feature matches an existing epic. The merge target ID becomes `featureId`. New tasks are added with `featureId` = an epic ID. Since `LEVEL_HIERARCHY.task` allows parent `["feature", "epic"]`, `insertChild` succeeds — but tasks become direct children of the epic, orphaned from any feature grouping.

**Fix required (3 parts):**

1. **Primary: Add level filtering to `matchProposalNodeToPRD`** (`smart-add-duplicates.ts:288-323`) — only match epic↔epic, feature↔feature, task↔task. Add a guard in `scoreNodeAgainstItem` or in the caller's loop: skip items whose `level` doesn't match `node.kind`.

2. **Secondary: Validate merge targets in `acceptProposals`** (`smart-add.ts:~791-880`) — before using a merge target ID as a parent, verify the existing item has the expected level. If not, fall back to creating a new item instead of silently using the wrong parent.

3. **Optional: Batch mutations for atomicity** — currently each `store.addItem()` individually loads/saves the document. If any add fails mid-loop, previously persisted items stay → inconsistent partial state. Consider collecting all mutations and saving once at the end.

**Key files:**
- `packages/rex/src/cli/commands/smart-add-duplicates.ts` — `matchProposalNodeToPRD` (lines 288-323), `scoreNodeAgainstItem` (lines 213-250)
- `packages/rex/src/cli/commands/smart-add.ts` — `acceptProposals` (lines ~787-883), `applyDuplicateProposalMerges` (lines 458-533)
- `packages/rex/src/store/file-adapter.ts` — `addItem` (lines 45-56)
- `packages/rex/src/core/tree.ts` — `insertChild` (lines 50-78)
  - matchProposalNodeToPRD only matches nodes against PRD items of the same level (epic↔epic, feature↔feature, task↔task)
  - acceptProposals validates merge target level before using it as a parent, falls back to creation on mismatch
  - Existing integration test (smart-add-duplicate-outcomes.test.ts) continues to pass
  - New test: cross-level match is rejected (e.g. proposed epic with same title as existing task does NOT produce a duplicate match)
  - New test: merge with level-matched duplicates correctly merges fields and adds non-duplicate children under the right parent
- Address observation issues (5 findings) *(feature)*
  - Bidirectional coupling: "dashboard-mcp-server" ↔ "web-package-shell" (2+4 crossings) — consider extracting shared interface
- The task-usage-tracking ↔ dashboard-mcp-server coupling cycle is the only inter-zone warning in this batch and should be resolved to preserve clean unidirectional data flow in the analytics subsystem.
- Fan-in hotspot: packages/rex/src/schema/index.ts receives calls from 22 files — high-impact module, changes may have wide ripple effects
- Bidirectional imports between this zone and dashboard-mcp-server (2 imports in each direction) create a coupling cycle; consider inverting the dependency or introducing an event/callback boundary.
- Coupling of 0.5 driven by 6 imports from dashboard-mcp-server suggests this cluster is a natural sub-module of that zone rather than an independent architectural boundary.
- Address anti-pattern issues (2 findings) *(feature)*
  - God function: main in packages/rex/src/cli/index.ts calls 48 unique functions — consider decomposing into smaller, focused functions
- God function: usePRDActions in packages/web/src/viewer/hooks/use-prd-actions.ts calls 39 unique functions — consider decomposing into smaller, focused functions

