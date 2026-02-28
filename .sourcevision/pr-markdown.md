## Summary

**Branch:** `featuer/oops`
**Base:** `main`
**Completed items:** 390

| Epic | Completed |
|------|-----------|
| Codex Vendor Reliability and Documentation | 9 |
| Selective Recommendation Acceptance Syntax | 6 |
| Init-time LLM Onboarding and Authentication | 8 |
| Live PR Markdown in SourceVision UI | 11 |
| SourceVision PR Markdown Tab Parity Hardening | 7 |
| SourceVision PR Markdown Quality & Manual Refresh | 12 |
| Rex Token Usage & LLM Utilization UX Overhaul | 15 |
| ndx Dashboard Refresh Orchestration | 12 |
| Token Event Attribution Accuracy | 8 |
| Deterministic Task Utilization Budget Fallback | 6 |
| Dashboard Navigation Information Architecture | 4 |
| Duplicate-aware Proposal Override for rex add | 12 |
| Dashboard Route Ownership Decoupling | 6 |
| PR Markdown Reviewer Context Enrichment | 6 |
| SourceVision PR Markdown Refresh Degraded-Mode Hardening | 8 |
| SourceVision PR Markdown Git Preflight and Credential Diagnostics | 7 |
| SourceVision Semantic Diff Failure UX Hardening | 6 |
| SourceVision PR Markdown Artifact-Based Fallback Mode | 11 |
| Git Credential Helper Opt-In Recovery | 6 |
| SourceVision Semantic Diff Determinism and Tooling-Drift Hardening | 5 |
| Git-Independent PR Markdown Generation | 7 |
| PR Markdown View Toggle and Copy UX | 6 |
| Process Lifecycle Management and Graceful Shutdown | 14 |
| LLM Client Circular Dependency Resolution | 12 |
| Rex Task and Epic Deletion Functionality | 13 |
| PR Build Pipeline and Code Quality Automation | 6 |
| Web UI Memory Management and Crash Resolution | 11 |
| Interactive PRD Validation and Consistency Resolution | 3 |
| Branch Work System of Record | 7 |
| Automatic PR Markdown Generation | 7 |
| Enhanced Rex Recommend Selective PRD Creation | 12 |
| Memory-Aware Polling Loop Management | 8 |
| WebSocket Message Performance Optimization | 6 |
| TreeNodes DOM Performance Optimization | 11 |
| Timer Performance Optimization and Re-render Reduction | 8 |
| API Request Deduplication and Coordination | 5 |
| Token Usage Aggregation Performance Optimization | 10 |
| Background Tab Resource Optimization | 14 |
| Hench Process Concurrency Management | 8 |
| Hench Resource Monitoring and User Feedback | 8 |
| WebSocket Connection Lifecycle Management | 5 |
| Rex Web UI Search Interface | 2 |

## ⚠️ Breaking Changes

- **Add PR Markdown tab to SourceVision navigation and routing**
  Expose a first-class tab so users can find PR-ready output without leaving SourceVision or running separate commands.
  - Sidebar or section navigation includes a PR Markdown entry under SourceVision
  - Selecting the tab updates URL/hash routing consistently with existing patterns
  - Tab loads without breaking existing SourceVision views
  - Tab displays initial loading, success, and empty states
- **Top-level Token Usage Navigation**
  Expose Token Usage as a first-class dashboard destination at the same hierarchy level as Settings without breaking existing navigation contracts.
- **Expose override markers in CLI/status and machine-readable outputs**
  Ensure override decisions are visible to operators and automation so duplicate exceptions can be reviewed and governed.
  - Rex status/output surfaces an indicator for items created via force-create override
  - JSON outputs include override marker fields without breaking existing schema consumers
  - Output clearly differentiates override-created items from merged or normal additions
- **Implement canonical redirect rules from legacy Rex token URLs**
  Add or refine redirect normalization so old Rex-prefixed token usage URLs resolve to the global token usage route, preserving user bookmarks and shared links during the ownership migration.
  - Legacy Rex token usage URL variants redirect to the canonical global token usage URL
  - Redirect logic avoids loops and always terminates at a single canonical destination
  - Direct navigation to the canonical token usage URL renders without intermediate error states
- **Review sourcevision circular dependency findings for llm-client package**
  ## Findings

Sourcevision analysis (2026-02-24T05:11:49, git sha 536ec50) detected **4 circular dependency chains** in `packages/llm-client/src/`.

### Root Cycle

All 4 chains are sub-paths of a single root cycle:

```
provider-interface.ts → llm-types.ts → create-client.ts → api-provider.ts → provider-interface.ts
provider-interface.ts → llm-types.ts → create-client.ts → cli-provider.ts → provider-interface.ts
```

### Dependency Graph (pre-fix)

```
provider-interface.ts ──imports LLMVendor──→ llm-types.ts
       ↑                                          │
       │                              imports CreateClientOptions
       │                                          ↓
 api/cli-provider.ts ←──provides factory── create-client.ts
       │
       └──imports LLMProvider──→ provider-interface.ts
```

### The 4 Chains Reported

1. `api-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts`
2. `api-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts` (type import duplicate)
3. `provider-interface.ts → llm-types.ts → create-client.ts`
4. `cli-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts`

### Affected Modules

- `provider-interface.ts` — LLMProvider interface + (was) LLMVendor consumer
- `llm-types.ts` — vendor-neutral types + (was) LLMVendor definition
- `create-client.ts` — Claude dual-provider factory
- `api-provider.ts` — Anthropic SDK provider
- `cli-provider.ts` — Claude CLI provider

### Root Cause

`provider-interface.ts` imported `LLMVendor` from `llm-types.ts`. `llm-types.ts` imported `CreateClientOptions` from `create-client.ts`. Both providers imported `LLMProvider` from `provider-interface.ts` to implement it. This formed a structural cycle even though all cross-layer imports were `import type`.

### Resolution (already applied in prior session)

`LLMVendor` was moved from `llm-types.ts` to `provider-interface.ts` as a self-contained definition. `llm-types.ts` re-exports it for backward compatibility. The `provider-interface.ts → llm-types.ts` import edge was eliminated, breaking all 4 chains. Zero circular dependencies remain.
  - All circular dependency cycles in llm-client are documented with affected modules
  - Dependency graph visualization shows current circular relationships
  - Root causes of each circular dependency are identified
- **Design dependency refactoring strategy for llm-client**
  ## Dependency Refactoring Strategy: llm-client Circular Dependency Resolution

### Problem Statement
Sourcevision identified 4 circular dependency chains in packages/llm-client, all rooted in one cycle:
  provider-interface.ts → llm-types.ts → create-client.ts → (api|cli)-provider.ts → provider-interface.ts

### Root Cause Analysis
The cycle formed through these steps:
1. provider-interface.ts imported LLMVendor from llm-types.ts
2. llm-types.ts imported CreateClientOptions (type) from create-client.ts
3. create-client.ts imported createApiClient/createCliClient from provider modules
4. Provider modules imported LLMProvider/ProviderInfo from provider-interface.ts

### Dependency Layer Hierarchy
The llm-client module has 7 distinct layers:
- Layer 0 (foundation): types.ts, exec.ts, output.ts, json.ts, help-format.ts, suggest.ts
- Layer 1 (interfaces): provider-interface.ts — generic LLMProvider contract
- Layer 2 (config): config.ts, llm-config.ts
- Layer 3 (providers): api-provider.ts, cli-provider.ts, codex-cli-provider.ts
- Layer 4 (factories): create-client.ts, llm-client.ts
- Layer 5 (management): provider-registry.ts, provider-session.ts
- Layer 6 (aggregation): llm-types.ts, public.ts

### Strategy: Type Relocation via Dependency Inversion
**Chosen approach**: Move LLMVendor from Layer 6 (llm-types.ts) to Layer 1 (provider-interface.ts), then re-export from llm-types.ts for backward compatibility.

**Rationale**:
- LLMVendor identifies which vendor a provider implements — it belongs with the provider interface contract
- provider-interface.ts is the lowest layer that uses the type (ProviderInfo.vendor: LLMVendor)
- Re-exporting from llm-types.ts ensures zero breaking changes for existing consumers

**Alternatives considered and rejected**:
1. Extract to vendors.ts (new file): Adds a new file for a two-value type union; hard to discover
2. Move CreateClientOptions to llm-types.ts: Makes llm-types.ts import from factories (wrong direction)
3. Use import type everywhere: Already applied but does not break structural/tool-detected cycles
4. Split provider-interface.ts: Over-engineering; the file is small and cohesive

### Modules Changed
- provider-interface.ts: +8 lines — define and export LLMVendor with explanatory comment
- llm-types.ts: +2 lines — import LLMVendor from provider-interface.ts and re-export it

### Backward Compatibility
- All consumers of LLMVendor from @n-dx/llm-client continue to work unchanged
- public.ts exports unchanged
- No changes required in dependent packages (hench, rex, sourcevision, web, claude-client)

### Verification
- 323/323 tests pass in @n-dx/llm-client after the fix
- Runtime import graph: no circular dependencies remain
- Type-only imports (import type) form no runtime cycles and are safe
- Sourcevision circular dependency chain count: 4 → 0
  - Refactoring plan specifies which modules to split or merge
  - Strategy identifies shared abstractions to extract
  - Plan maintains backward compatibility for public API
  - Approach minimizes impact on dependent packages
- **Update package exports to maintain public API compatibility**
  Ensure that public API exports remain consistent after internal restructuring, updating index files and package.json exports as needed
  - All public exports remain available at same paths
  - Package.json exports configuration is updated correctly
  - No breaking changes to external consumers
  - Internal reorganization is transparent to users
- **Implement remove task function in rex core**
  Create core function to safely remove individual tasks from the PRD structure while preserving parent-child relationships
  - Function removes task from parent feature/epic
  - Updates parent completion status if needed
  - Handles task dependencies and blocked relationships
  - Validates task exists before attempting removal
- **Implement branch work record JSON schema and storage**
  Define a JSON schema for tracking branch-specific work completion and implement file-based storage within the sourcevision package directory structure
  - JSON schema includes epic/feature/task hierarchy with completion timestamps
  - Schema supports metadata fields for change significance and breaking change flags
  - File is stored within .sourcevision/ directory with branch-specific naming
  - Schema validation prevents malformed records
- **Implement change significance classification**
  Add logic to classify completed work items by significance level (major changes, breaking changes, important functions) based on rex metadata and task descriptions
  - Breaking change detection from rex task tags and descriptions
  - Major change identification based on epic scope and task count
  - Important function classification from task acceptance criteria
  - Classification results persisted in branch work record
- **Remove manual PR markdown refresh mechanism**
  Remove the manual refresh button and endpoint from the SourceVision UI, making PR markdown generation fully automatic through the analyze flow
  - Manual refresh button removed from SourceVision PR markdown tab
  - Refresh endpoint removed from web server routes
  - UI displays clear messaging about automatic generation via analyze
  - Existing cached PR markdown remains accessible until next analyze run
- **Implement rex-based PR markdown template**
  Create a new PR markdown template that generates content from branch work record data, emphasizing completed epics, features, and significant changes
  - Template generates clean epic/feature completion list
  - Markdown highlights breaking changes with clear indicators
  - Template includes major change summary section
  - Important functions and features are prominently featured
- **Implement significance-based content prioritization**
  Structure generated PR markdown to prioritize content by significance level, featuring breaking changes and major updates prominently
  - Breaking changes appear in dedicated high-visibility section
  - Major features listed before minor tasks
  - Important function changes highlighted with code context
  - Content organization follows reviewer-friendly priority order

## Major Changes

- **Codex Vendor Reliability and Documentation**
- **Implement normalized Codex response extraction in Hench run parser** [critical]
  Add a dedicated normalization layer that converts Codex-mode responses (including tool calls, partial text blocks, and completion markers) into the internal run event format used by Hench.
- **Map Codex usage payloads to unified token metrics** [critical]
  Implement explicit field mapping from Codex response usage data into the shared token accounting model used by Hench and Rex reports.
- **Selective Recommendation Acceptance Syntax**
- **Implement equals-prefixed index selector parsing for `recommend --accept`** [critical]
  Add command parsing support for values like `=1,4,5` so users can target specific recommendation indices without changing existing all-accept behavior.
- **Apply indexed selection to recommendation acceptance workflow** [critical]
  Wire parsed indices into the acceptance pipeline so only selected recommended items are accepted and persisted, preserving original recommendation ordering.
- **Init-time LLM Onboarding and Authentication**
- **Present interactive LLM provider selection screen** [critical]
  Add a user-friendly selection prompt during init that allows choosing `codex` or `claude` as the active provider.
- **Implement provider-specific auth status checks** [critical]
  Run a provider-specific preflight command after selection to determine whether the current shell session is authorized for the selected LLM.
- **Prompt provider-specific login command on auth failure** [critical]
  When preflight fails, show clear remediation with the exact login command for the chosen provider so users can complete setup immediately.
- **Live PR Markdown in SourceVision UI**
- **Implement PR markdown generator for current branch vs main** [critical]
  Create a generator that builds a structured markdown summary from git diff output so users can paste directly into pull requests without manual rewriting.
- **Implement auto-refresh triggers for file and git diff changes** [critical]
  Update the tab content automatically when the working tree or diff baseline changes so users always see current PR text without manual refresh.
- **SourceVision PR Markdown Tab Parity Hardening**
- **Register PR Markdown in the shared SourceVision tab configuration** [critical]
  Centralize PR Markdown in the same tab metadata structure used by Import Graph and Zones so sidebar rendering and view wiring are driven by one source of truth.
- **Normalize PR Markdown hash route parsing and tab selection state** [critical]
  Align PR Markdown route/hash handling with existing SourceVision views to prevent mismatches between URL, selected tab, and rendered content.
- **Integrate PR Markdown view with data and state endpoints under a unified refresh loop** [critical]
  Use `/api/sv/pr-markdown` for content and `/api/sv/pr-markdown/state` for availability, with coordinated refresh behavior so UI state and markdown output stay in sync.
- **Render cause-specific empty and error states with remediation guidance** [critical]
  Provide explicit messages and fix steps for known unavailability causes so users can self-resolve setup issues quickly.
- **SourceVision PR Markdown Quality & Manual Refresh**
- **Redesign PR markdown template around scope, notable changes, and shoutouts** [critical]
  Establish a new output structure that leads with concise scope-of-work and key highlights so reviewers can understand intent quickly.
- **Remove exhaustive per-file change tables from generated markdown** [critical]
  Reduce cognitive load by deleting detailed per-file tabular output and replacing it with concise grouped summaries.
- **Add SourceVision CLI command to refresh PR markdown on demand** [critical]
  Provide an explicit command entry point so users can regenerate PR markdown only when they choose.
- **Persist generated PR markdown and refresh metadata as cached artifact** [critical]
  Store generated content and metadata (including refresh timestamp and error state) so the UI can display stable results without recomputing.
- **Remove automatic PR markdown refresh triggers from file and git change watchers** [critical]
  Eliminate background regeneration to make freshness explicit and predictable for users.
- **Rex Token Usage & LLM Utilization UX Overhaul**
- **Implement unified usage event normalization across Rex, Hench, and SourceVision logs** [critical]
  Create a shared normalization path that converts vendor-specific usage payloads into one canonical shape so downstream aggregation is consistent.
- **Fix Rex token aggregation queries that return zero for tasks and dashboard totals** [critical]
  Correct the aggregation logic and joins/lookups so token totals resolve from normalized usage events to task-level and project-level views.
- **Repair task token tag binding to accumulated usage totals** [critical]
  Fix task metadata mapping so each task reflects real summed usage from associated runs rather than stale or defaulted values.
- **ndx Dashboard Refresh Orchestration**
- **Add `ndx refresh` command to CLI orchestration entrypoint** [critical]
  Expose a dedicated refresh command in the top-level CLI so dashboard refresh workflows are accessible without package-specific commands, reducing operator friction and script complexity.
- **Implement refresh plan builder for flag combinations and conflicts** [critical]
  Translate flag combinations into explicit step plans so each invocation has predictable behavior and invalid combinations are rejected before work starts.
- **Implement SourceVision-derived dashboard artifact refresh step** [critical]
  Add orchestration logic that refreshes generated dashboard artifacts used by the web UI so analysis-derived views stay synchronized with repository state.
- **Token Event Attribution Accuracy**
- **Persist vendor/model on Rex token usage events** [critical]
  Update Rex usage event emission to attach vendor and model from the active request context so each event is self-describing and survives config changes.
- **Persist vendor/model on Hench token usage events** [critical]
  Capture vendor/model at the moment Hench records run and task token usage so mixed-provider runs are attributed correctly per event.
- **Refactor utilization aggregation to group by event vendor/model** [critical]
  Change aggregation queries and reducers to use vendor/model stored on each event as the grouping key so historical and mixed-model usage is reported correctly.
- **Deterministic Task Utilization Budget Fallback**
- **Implement deterministic weekly budget resolver for vendor/model scopes** [critical]
  Create a single resolver that selects the weekly budget in a fixed order to eliminate ambiguous behavior when model-specific configuration is missing.
- **Wire deterministic budget resolver into task chip and detail utilization calculations** [critical]
  Route all task-level utilization percentage computation through the shared resolver so chips and detail panels cannot diverge.
- **Dashboard Navigation Information Architecture**
- **Preserve legacy deep links by routing old Token Usage URLs to the new top-level destination** [critical]
  Existing bookmarks and shared links must continue working so teams do not lose access patterns after the navigation restructure.
- **Duplicate-aware Proposal Override for rex add**
- **Implement proposal-to-PRD duplicate matching across open and completed items** [critical]
  Prevent accidental duplicate creation by comparing generated proposal nodes against current PRD hierarchy, including completed epics/features/tasks that should still be considered duplicates.
- **Persist override marker metadata on force-created PRD items** [critical]
  Create an auditable record that a duplicate guard was overridden, including enough metadata to trace when and why the override happened.
- **Dashboard Route Ownership Decoupling**
- **Remove token-usage from Rex view scope registry** [critical]
  Prevent Rex-scoped route resolution from claiming Token Usage by deleting the token-usage entry from `VIEWS_BY_SCOPE.rex`. This eliminates conflicting ownership and ensures the route is resolved by global navigation config only.
- **Add regression tests for direct global reachability and legacy redirects** [critical]
  Create automated routing tests to prove Token Usage is directly reachable as a global destination and that legacy Rex links remain compatible through redirects.
- **PR Markdown Reviewer Context Enrichment**
- **Implement branch-to-PRD work item resolver** [critical]
  Create a resolver that maps branch changes to completed or in-progress PRD tasks and derives their parent epic titles, so PR summaries can show intent-level context instead of only code-level changes.
- **Implement significant-function and feature highlight extraction** [critical]
  Add logic to identify newly added or materially changed high-impact functions and user-visible features, enabling summaries that focus on reviewer-relevant changes.
- **SourceVision PR Markdown Refresh Degraded-Mode Hardening**
- **Implement degraded refresh response contract with cache retention** [critical]
  Ensure refresh returns a non-500 structured payload when generation fails for known git/base-branch conditions and cached markdown exists, so users keep usable output instead of losing access.
- **Add refresh failure classifier for git and base-branch resolution errors** [critical]
  Classify refresh failures into explicit diagnostic codes so clients can provide precise remediation guidance and avoid generic server-error messaging.
- **SourceVision PR Markdown Git Preflight and Credential Diagnostics**
- **Implement repository state preflight before PR markdown refresh** [critical]
  Add a preflight step that verifies the working directory is a git repository and the current HEAD is attached to a branch before any diff or fetch operation runs.
- **Add remote reachability and credential preflight checks** [critical]
  Proactively test remote connectivity and authentication so fetch-related issues are classified before refresh attempts fail with generic git errors.
- **SourceVision Semantic Diff Failure UX Hardening**
- **Guard cached PR markdown from semantic diff-stage invalidation** [critical]
  Prevent refresh from overwriting or clearing the last successful PR markdown artifact when failure occurs specifically during semantic diff inspection, preserving reviewer continuity.
- **SourceVision PR Markdown Artifact-Based Fallback Mode**
- **Implement git-failure fallback routing in PR markdown refresh pipeline** [critical]
  Route refresh execution to a fallback generator whenever preflight, fetch, or diff stages fail so the endpoint returns usable PR content instead of only an error state.
- **Add unit tests for fallback trigger classification across git failure modes** [critical]
  Protect routing logic by verifying that only intended preflight/fetch/diff failures activate fallback generation.
- **Git Credential Helper Opt-In Recovery**
- **Classify git auth failures and attach opt-in remediation hints** [critical]
  When refresh fails due to credential or auth issues, return a specific failure classification with a clear suggestion to run the new helper command instead of generic git errors.
- **Enforce non-interactive default behavior in refresh path** [critical]
  Ensure refresh never opens interactive credential flows unless explicitly requested, preventing hangs in CI and preserving existing automation behavior.
- **SourceVision Semantic Diff Determinism and Tooling-Drift Hardening**
- **Enforce deterministic non-interactive flags for semantic diff git invocations** [critical]
  Prevent local external diff drivers, textconv filters, or interactive paging from changing semantic diff behavior so refresh results stay consistent across environments.
- **Split semantic diff and name-status diff execution into independently classified stages** [critical]
  Ensure a semantic diff failure does not get conflated with name-status collection so diagnostics and fallback decisions are accurate.
- **Git-Independent PR Markdown Generation**
- **Implement branch-scoped Rex work item collector** [critical]
  Build a collector that selects epics, features, and tasks relevant to the current branch from Rex state so PR summaries are grounded in planned and completed work, not git remote reachability.
- **Implement branch-scoped Hench run evidence collector** [critical]
  Add a run evidence layer that gathers executed-task context from Hench runs tied to the active branch so generated PR markdown reflects actual execution history.
- **Replace git-remote dependency in PR markdown refresh flow** [critical]
  Refactor the refresh pipeline to use the Rex/Hench branch evidence collectors as the primary and required data source, eliminating dependency on external git repository connectivity.
- **PR Markdown View Toggle and Copy UX**
- **Process Lifecycle Management and Graceful Shutdown**
- **Implement unified signal handler with cascading cleanup** [critical]
  Implemented unified signal handler with cascading cleanup (commit cb60d1c). Changes: (1) packages/web/src/server/start.ts: extracted registerShutdownHandlers() as an exported testable function with 30s overall timeout (configurable via N_DX_SHUTDOWN_TIMEOUT_MS env var), double-signal handling (second SIGINT/SIGTERM forces immediate exit(1) while graceful shutdown is still running), signal name in logs, and injectable exit dep for testing. The function runs cleanup in dependency order: hench child processes first then WebSocket connections then HTTP server then port file. (2) packages/web/tests/unit/server/shutdown-handler.test.ts: 13 new unit tests covering signal handler registration, cleanup ordering, SIGINT/SIGTERM name logging, double-signal force-exit, timeout force-exit, timeout error message, port file removal, and completion log.
- **Add process tree cleanup with force termination fallback** [critical]
  Implement comprehensive child process cleanup that gracefully terminates processes with force-kill fallback for unresponsive processes
- **Implement port cleanup and resource release procedures** [critical]
  Add explicit port unbinding and resource cleanup procedures that execute during graceful shutdown to prevent port conflicts
- **LLM Client Circular Dependency Resolution**
- **Validate circular dependency resolution with sourcevision re-analysis** [critical]
  Run sourcevision analysis again on the refactored llm-client package to confirm all circular dependencies have been eliminated and no new issues were introduced
- **Execute comprehensive test suite to ensure functionality preservation** [critical]
  Test results: llm-client 323/323 tests pass. claude-client 211/211 tests pass. hench 912/912 tests pass (after fixing stale help text assertion). rex 2291/2300 tests pass (after fixing modify-reason.test.ts mock to use createLLMClient/detectLLMAuthMode). Pre-existing failures noted: feature-filtered-task.test.ts (9 failures for unimplemented featureId filter, commit 90442f0 Feb 13 2026) and sourcevision cli-serve.test.ts (1 e2e timeout, environment limitation). Commit: 3a5556b
- **Rex Task and Epic Deletion Functionality**
- **Implement remove epic function in rex core** [critical]
  Create core function to safely remove an epic from the PRD structure, handling child tasks and maintaining data integrity
- **PR Build Pipeline and Code Quality Automation**
- **Web UI Memory Management and Crash Resolution**
- **Profile memory usage patterns during web UI load and refresh cycles** [critical]
  Use browser dev tools and memory profiling to identify memory allocation patterns, leaks, and peak usage during initial load and subsequent refresh operations
- **Fix memory leaks in refresh orchestration and component lifecycle** [critical]
  Identify and resolve memory leaks in React components, event listeners, timers, and refresh orchestration that prevent proper garbage collection
- **Interactive PRD Validation and Consistency Resolution**
- **Branch Work System of Record**
- **Automatic PR Markdown Generation**
- **Enhanced Rex Recommend Selective PRD Creation**
- **Implement selective PRD creation from selected recommendations** [critical]
  Create PRD items from the selected recommendations using the existing rex add pipeline, replacing the acknowledge-only behavior
- **Memory-Aware Polling Loop Management**
- **WebSocket Message Performance Optimization**
- **TreeNodes DOM Performance Optimization**
- **Timer Performance Optimization and Re-render Reduction**
- **API Request Deduplication and Coordination**
- **Token Usage Aggregation Performance Optimization**
- **Background Tab Resource Optimization**
- **Hench Process Concurrency Management**
- **Hench Resource Monitoring and User Feedback**
- **WebSocket Connection Lifecycle Management**
- **Rex Web UI Search Interface**

## Completed Work

### API Request Deduplication and Coordination

**Request deduplication infrastructure**
- Implement request deduplication for fetchPRDData calls
  Add in-flight request tracking to prevent duplicate fetchPRDData API calls when WebSocket messages arrive during active polling requests
  - fetchPRDData returns same promise when called while previous request is in-flight
  - WebSocket message during 10s poll does not trigger duplicate API call
  - Request tracking cleanup occurs when API call completes or fails
- Implement request deduplication for fetchTaskUsage calls
  Add in-flight request tracking to prevent duplicate fetchTaskUsage API calls when WebSocket messages arrive during active polling requests
  - fetchTaskUsage returns same promise when called while previous request is in-flight
  - Multiple simultaneous usage requests resolve to single API call
  - Request tracking handles both successful and error responses
- Coordinate execution panel polling with WebSocket triggers
  Implement coordination mechanism between execution-panel 3s polling and WebSocket message triggers to prevent simultaneous /api/rex/execute/status requests
  - Execution panel polling respects in-flight requests from WebSocket handlers
  - WebSocket handlers respect in-flight requests from polling loop
  - Maximum one /api/rex/execute/status request active at any time
- Add integration tests for request deduplication
  Create comprehensive test suite validating that request deduplication works correctly under various timing scenarios and prevents duplicate API calls
  - Tests verify no duplicate API calls during overlapping fetch operations
  - Tests cover WebSocket message arrival during active polling
  - Tests validate request cleanup after completion and errors

- Request deduplication infrastructure *(feature)*
  Prevent duplicate in-flight requests by tracking active API calls and returning shared promises for identical requests

### Automatic PR Markdown Generation

**Rex-based content generation**
- ⚠️ **Implement rex-based PR markdown template**
  Create a new PR markdown template that generates content from branch work record data, emphasizing completed epics, features, and significant changes
  - Template generates clean epic/feature completion list
  - Markdown highlights breaking changes with clear indicators
  - Template includes major change summary section
  - Important functions and features are prominently featured
- ⚠️ **Implement significance-based content prioritization**
  Structure generated PR markdown to prioritize content by significance level, featuring breaking changes and major updates prominently
  - Breaking changes appear in dedicated high-visibility section
  - Major features listed before minor tasks
  - Important function changes highlighted with code context
  - Content organization follows reviewer-friendly priority order
- Replace git-diff dependency with rex completion data
  Remove reliance on git diff output for PR content generation, using rex completion status and branch work record as the authoritative source
  - PR markdown generation no longer calls git diff commands
  - Content derived entirely from branch work record and rex data
  - Generation works without git history or remote access
  - Fallback behavior for missing rex data provides meaningful output

**Sourcevision analyze integration**
- ⚠️ **Remove manual PR markdown refresh mechanism**
  Remove the manual refresh button and endpoint from the SourceVision UI, making PR markdown generation fully automatic through the analyze flow
  - Manual refresh button removed from SourceVision PR markdown tab
  - Refresh endpoint removed from web server routes
  - UI displays clear messaging about automatic generation via analyze
  - Existing cached PR markdown remains accessible until next analyze run
- Integrate PR markdown generation into sourcevision analyze command
  Modify the sourcevision analyze command to automatically generate PR markdown as part of its standard execution flow using the branch work record
  - PR markdown generation executes as final step of sourcevision analyze
  - Generation uses branch work record as primary data source
  - Command maintains existing analyze functionality unchanged
  - Generated markdown overwrites any existing cached PR content

- Sourcevision analyze integration *(feature)*
  Integrate PR markdown generation directly into the sourcevision analyze command flow, replacing the manual refresh mechanism
- Rex-based content generation *(feature)*
  Generate PR markdown content from rex completion data rather than git differences, focusing on completed work items and their significance

### Background Tab Resource Optimization

**Memory and DOM Optimization for Inactive Tabs**
- Prevent DOM updates during tab inactive state
  Block DOM updates and re-renders when tab is backgrounded to save memory and CPU resources
  - Queues DOM updates instead of applying them during inactive state
  - Prevents unnecessary component re-renders in background tabs
  - Maintains UI state consistency for deferred updates
- Implement memory-efficient response buffering suspension
  Suspend response buffering and data processing during background tab state to reduce memory usage
  - Stops accumulating API response data during inactive state
  - Prevents memory buildup from background polling responses
  - Maintains data integrity when buffering resumes

**Polling Suspension for Background Tabs**
- Suspend loader polling (5s interval) when tab is backgrounded
  Halt the 5-second loader polling interval when tab becomes inactive to prevent unnecessary API calls
  - Pauses 5s loader polling when tab visibility becomes hidden
  - Prevents loader API requests during background state
  - Maintains loader state consistency during suspension
- Suspend execution panel polling (3s interval) when tab is backgrounded
  Halt the 3-second execution panel polling when tab is inactive to reduce memory buffering
  - Pauses 3s execution panel polling when tab becomes hidden
  - Stops execution status API requests during background state
  - Preserves execution panel state during suspension period
- Suspend status polling (10s interval) when tab is backgrounded
  Halt the 10-second status polling when tab is inactive to prevent unnecessary status updates
  - Pauses 10s status polling when tab visibility becomes hidden
  - Stops status API requests during background state
  - Maintains status consistency during suspension
- Suspend usage polling (10s interval) when tab is backgrounded
  Halt the 10-second usage polling when tab is inactive to reduce token usage data fetching
  - Pauses 10s usage polling when tab becomes hidden
  - Stops usage API requests during background state
  - Preserves usage data state during suspension period

**Tab Activation Recovery and Synchronization**
- Resume all suspended polling when tab becomes active
  Restart all polling intervals immediately when tab visibility changes from hidden to visible
  - Resumes all suspended polling intervals when tab becomes active
  - Restarts polling with original intervals (5s, 3s, 10s, 10s)
  - Handles multiple rapid visibility changes gracefully
- Add integration tests for background suspension and recovery
  Create comprehensive tests for tab visibility polling suspension and recovery workflow
  - Tests polling suspension behavior when tab becomes inactive
  - Validates polling resumption when tab becomes active
  - Confirms memory optimization during background state

**Tab Visibility Detection and Control**
- Implement Page Visibility API for tab state detection
  Integrate browser Page Visibility API to detect when tab becomes active/inactive for resource management
  - Detects tab visibility state changes using Page Visibility API
  - Fires visibility change events to registered listeners
  - Handles browser compatibility and API availability gracefully
- Create centralized tab visibility state manager
  Build centralized service to coordinate tab visibility state across all polling components
  - Provides single source of truth for tab visibility state
  - Allows components to register for visibility change notifications
  - Maintains consistent state across all polling intervals

- Tab Visibility Detection and Control *(feature)*
  Implement browser tab visibility detection to enable resource-aware polling management
- Polling Suspension for Background Tabs *(feature)*
  Suspend all polling intervals when browser tab is backgrounded to reduce resource consumption
- Memory and DOM Optimization for Inactive Tabs *(feature)*
  Prevent memory waste from DOM updates and response buffering when tab is not visible
- Tab Activation Recovery and Synchronization *(feature)*
  Restore polling and synchronize data when tab becomes active again

### Branch Work System of Record

**JSON-based branch work tracking infrastructure**
- ⚠️ **Implement branch work record JSON schema and storage**
  Define a JSON schema for tracking branch-specific work completion and implement file-based storage within the sourcevision package directory structure
  - JSON schema includes epic/feature/task hierarchy with completion timestamps
  - Schema supports metadata fields for change significance and breaking change flags
  - File is stored within .sourcevision/ directory with branch-specific naming
  - Schema validation prevents malformed records
- ⚠️ **Implement change significance classification**
  Add logic to classify completed work items by significance level (major changes, breaking changes, important functions) based on rex metadata and task descriptions
  - Breaking change detection from rex task tags and descriptions
  - Major change identification based on epic scope and task count
  - Important function classification from task acceptance criteria
  - Classification results persisted in branch work record
- Create branch work collector service
  Build a service that queries rex PRD data to identify completed work items associated with the current branch and populates the branch work record
  - Service correctly identifies branch-specific completed rex items
  - Collector handles epic/feature/task hierarchy traversal
  - Service excludes work items not relevant to current branch
  - Collector gracefully handles missing or corrupted rex data

**Rex completion data integration**
- Implement rex PRD completion status reader
  Create a reader service that extracts completion status, timestamps, and metadata from rex PRD data for work items associated with the current branch
  - Reader correctly parses rex .prd.json file format
  - Service extracts completion timestamps and status transitions
  - Reader handles rex validation errors gracefully
  - Integration preserves rex data integrity
- Add branch-scoped work item filtering
  Implement filtering logic to identify which rex work items are relevant to the current branch based on git branch metadata and work item timestamps
  - Filter correctly identifies work completed during branch lifecycle
  - Logic handles branch creation and merge scenarios
  - Filter excludes work items from other branches or main
  - Filtering works with both feature and hotfix branch patterns

- JSON-based branch work tracking infrastructure *(feature)*
  Create a persistent JSON-based system within sourcevision to track completed epics, features, and tasks on the current branch
- Rex completion data integration *(feature)*
  Integrate with existing rex PRD system to extract completion status and work item details for branch work tracking

### Codex Vendor Reliability and Documentation

**Codex Token Accounting Accuracy**
- 🔶 **Map Codex usage payloads to unified token metrics**
  Implement explicit field mapping from Codex response usage data into the shared token accounting model used by Hench and Rex reports.
  - Input, output, and total token counts are populated from Codex usage data when available
  - When usage is absent, accounting records zero values plus a non-fatal diagnostic flag
  - Token mapping logic is isolated in a reusable function with unit tests
- Validate Codex token totals in run summaries and budget checks
  Wire mapped token metrics into run persistence and budget logic so Codex-mode runs affect totals identically to existing vendors.
  - Run summary output includes Codex-derived token totals
  - Budget threshold warnings trigger correctly for Codex-mode runs
  - Integration test confirms cumulative token totals increase after a Codex-mode execution

**Hench Codex Output Parsing Hardening**
- 🔶 **Implement normalized Codex response extraction in Hench run parser**
  Add a dedicated normalization layer that converts Codex-mode responses (including tool calls, partial text blocks, and completion markers) into the internal run event format used by Hench.
  - Parser accepts Codex responses with mixed text and tool-use blocks without throwing
  - Normalized output always includes status, assistant message text, and tool event metadata when present
  - Unknown block types are safely ignored with a warning instead of failing the run
- Add regression tests for malformed and partial Codex outputs
  Prevent future breakage by codifying edge cases seen in Codex mode, including truncated payloads and missing optional fields, so parser behavior is stable across vendor updates.
  - Test suite includes fixtures for truncated responses, empty content arrays, and missing usage fields
  - All malformed fixtures produce deterministic fallback behavior with no uncaught exceptions
  - CI passes with new parser tests enabled in the Hench test target

**Rex and Hench Vendor Behavior Documentation**
- Update README vendor matrix for Rex and Hench behavior differences
  Document per-vendor expectations for parsing, token accounting, and fallback behavior so users can choose providers with clear tradeoffs.
  - README includes a Rex/Hench vendor behavior section with Codex and Claude rows
  - Matrix explicitly lists token accounting support and known parsing constraints per vendor
  - Documentation references the relevant CLI/config options for selecting vendors
- Revise CODEX guidance with troubleshooting for parsing and usage discrepancies
  Add operational guidance for diagnosing Codex-mode output parsing failures and token mismatches, including expected logs and remediation steps.
  - CODEX documentation includes a troubleshooting section for malformed output and missing usage fields
  - Each issue includes concrete verification steps and expected command outcomes
  - Docs are consistent with implemented parser fallback and token-mapping behavior

- Hench Codex Output Parsing Hardening *(feature)*
  Make Hench resilient to Codex-mode response variations so task execution state is derived consistently even when tool output shape changes.
- Codex Token Accounting Accuracy *(feature)*
  Ensure Hench records token usage correctly in Codex mode so usage reporting and budget enforcement remain trustworthy.
- Rex and Hench Vendor Behavior Documentation *(feature)*
  Clarify how Rex and Hench behave across vendors, with explicit notes for Codex mode, to reduce operator confusion and support issues.

### Dashboard Navigation Information Architecture

**Top-level Token Usage Navigation**
- 🔶 **Preserve legacy deep links by routing old Token Usage URLs to the new top-level destination**
  Existing bookmarks and shared links must continue working so teams do not lose access patterns after the navigation restructure.
  - Legacy Token Usage route patterns resolve to the new top-level Token Usage destination
  - URL normalization preserves query params and hash fragments used by existing links
  - No 404 or blank-state regressions occur when opening previously valid deep links
- Add Token Usage as a peer top-level nav item to Settings
  Users need direct access to utilization analytics from primary navigation rather than discovering it inside Rex-specific views; this change improves findability and reinforces Token Usage as a cross-tool concern.
  - Main dashboard navigation renders a Token Usage item at the same hierarchy level as Settings
  - Selecting Token Usage loads the existing Token Usage view content without regressions in data rendering
  - Navigation ordering and visibility are deterministic across page reloads
- Align active-state highlighting with normalized Token Usage routes
  Active-state logic must remain trustworthy after route remapping so users always see accurate location context in navigation.
  - Token Usage nav item is highlighted for both new and legacy-normalized Token Usage URLs
  - Settings and other top-level items are not highlighted when Token Usage is active
  - Automated tests cover active-state behavior for direct load, in-app navigation, and legacy deep-link entry

- ⚠️ **Top-level Token Usage Navigation** *(feature)*
  Expose Token Usage as a first-class dashboard destination at the same hierarchy level as Settings without breaking existing navigation contracts.

### Dashboard Route Ownership Decoupling

**Globalize Token Usage Route Ownership**
- 🔶 **Remove token-usage from Rex view scope registry**
  Prevent Rex-scoped route resolution from claiming Token Usage by deleting the token-usage entry from `VIEWS_BY_SCOPE.rex`. This eliminates conflicting ownership and ensures the route is resolved by global navigation config only.
  - `VIEWS_BY_SCOPE.rex` no longer contains a `token-usage` entry
  - Route resolution for `token-usage` does not depend on Rex scope helpers
  - Existing Rex-only views still resolve without regression after the removal
- Re-map token-usage in route state and UI metadata as global
  Update route-state, breadcrumb, and product-label mapping tables so Token Usage is classified as global/cross-cutting rather than Rex-owned, preventing incorrect section highlights and labels.
  - Route-state mapping classifies `token-usage` under global scope
  - Breadcrumbs for `token-usage` render without Rex section ancestry
  - Product/section labels for `token-usage` show global ownership consistently in header and nav

**Legacy URL Compatibility and Routing Regression Coverage**
- ⚠️ **Implement canonical redirect rules from legacy Rex token URLs**
  Add or refine redirect normalization so old Rex-prefixed token usage URLs resolve to the global token usage route, preserving user bookmarks and shared links during the ownership migration.
  - Legacy Rex token usage URL variants redirect to the canonical global token usage URL
  - Redirect logic avoids loops and always terminates at a single canonical destination
  - Direct navigation to the canonical token usage URL renders without intermediate error states
- 🔶 **Add regression tests for direct global reachability and legacy redirects**
  Create automated routing tests to prove Token Usage is directly reachable as a global destination and that legacy Rex links remain compatible through redirects.
  - Test covers direct navigation to canonical `token-usage` route and validates successful render
  - Test covers at least one legacy Rex token URL and asserts redirect target equals canonical global route
  - Test suite fails if token-usage is reintroduced under Rex scope mappings

- Globalize Token Usage Route Ownership *(feature)*
  Make Token Usage a first-class global dashboard destination instead of a Rex-scoped view so routing and UI metadata remain consistent across sections.
- Legacy URL Compatibility and Routing Regression Coverage *(feature)*
  Keep old Rex Token Usage links functional while enforcing the new global canonical route through deterministic redirects and tests.

### Deterministic Task Utilization Budget Fallback

**Task-Level Utilization Chips and Details Fallback UX**
- 🔶 **Wire deterministic budget resolver into task chip and detail utilization calculations**
  Route all task-level utilization percentage computation through the shared resolver so chips and detail panels cannot diverge.
  - Task chips and task detail views use the same resolver output for budget selection
  - When budget is resolved, utilization displays as a percentage rounded consistently across views
  - When budget is missing, both views render the same fallback label and reason state
  - No direct ad-hoc budget lookup remains in task-level UI calculation paths
- Add integration tests for missing-budget and partial-budget task utilization states
  Prevent regressions by verifying deterministic behavior for configured, partially configured, and unconfigured budget scenarios at task level.
  - Integration tests cover: exact vendor/model budget, vendor-only fallback, and no-budget fallback
  - Each scenario asserts chip text, detail text, and reason-code consistency
  - Tests verify identical utilization output for the same task across list and detail views
  - CI fails if fallback presentation or reason mapping changes unexpectedly

**Vendor/Model Budget Resolution Rules**
- 🔶 **Implement deterministic weekly budget resolver for vendor/model scopes**
  Create a single resolver that selects the weekly budget in a fixed order to eliminate ambiguous behavior when model-specific configuration is missing.
  - Resolver checks budget sources in documented order: vendor+model, vendor default, global default, then explicit no-budget
  - Given matching vendor+model budget, resolver returns that value and source `vendor_model`
  - Given missing model budget but present vendor default, resolver returns vendor default and source `vendor_default`
  - Given no configured budget at any level, resolver returns a no-budget sentinel and source `missing_budget`
- Validate weekly budget configuration and emit stable fallback diagnostics
  Harden config loading so invalid or partial budget data cannot produce inconsistent utilization calculations across runs.
  - Invalid budget entries (non-numeric, negative, NaN) are rejected with actionable validation errors
  - Config parsing normalizes vendor/model keys consistently before lookup
  - When lookup falls back or returns missing-budget, a machine-readable reason code is emitted for downstream UI use
  - Unit tests cover valid, partial, and invalid budget configurations

- Vendor/Model Budget Resolution Rules *(feature)*
  Define a deterministic resolution path for weekly token budgets so task-level utilization always computes from a known source or a consistent fallback state.
- Task-Level Utilization Chips and Details Fallback UX *(feature)*
  Ensure task-level utilization displays remain deterministic and understandable when weekly budgets are missing or only partially configured.

### Duplicate-aware Proposal Override for rex add

**Documentation and Test Coverage for Duplicate Overrides**
- Update CLI help and docs for duplicate detection and override choices
  Reduce operator confusion by documenting when duplicate prompts appear, what each option does, and how audit markers are represented.
  - CLI help for rex add documents duplicate-aware prompt behavior and all three actions
  - User-facing docs include examples for Cancel, Merge, and Proceed anyway flows
  - Docs describe persisted override marker semantics and where they appear
- Add unit and integration tests for duplicate detection, prompt outcomes, and override persistence
  Protect against regressions by testing detection accuracy and each user decision path end-to-end through persisted PRD state.
  - Unit tests cover duplicate matcher behavior for existing and completed-item matches
  - Integration tests verify Cancel writes nothing, Merge updates existing, and Proceed anyway creates marked items
  - Tests assert override marker presence only on force-created items and absence on merged/normal items

**Duplicate Detection and Reason Classification**
- 🔶 **Implement proposal-to-PRD duplicate matching across open and completed items**
  Prevent accidental duplicate creation by comparing generated proposal nodes against current PRD hierarchy, including completed epics/features/tasks that should still be considered duplicates.
  - Given a proposal with title/content matching an existing open item, the matcher returns a duplicate result with referenced item id
  - Given a proposal matching a completed item, the matcher still returns a duplicate result with completed status context
  - Given a proposal with no meaningful overlap, the matcher returns a non-duplicate result and does not block normal flow
- Attach structured duplicate reasons to generated proposals
  Make override decisions understandable by attaching machine-readable and human-readable reason metadata that explains what matched and why the item is considered duplicate.
  - Each duplicate proposal includes reason type, matched item reference, and concise explanation text
  - Reason payload distinguishes match context such as exact title match, semantic match, or completed-item match
  - Non-duplicate proposals do not include duplicate reason metadata

**Force-create Auditability and Visibility**
- 🔶 **Persist override marker metadata on force-created PRD items**
  Create an auditable record that a duplicate guard was overridden, including enough metadata to trace when and why the override happened.
  - Force-created items store an override marker field in persisted PRD data
  - Override marker captures duplicate reason reference and creation timestamp
  - Items created through normal or merge paths do not receive override markers
- ⚠️ **Expose override markers in CLI/status and machine-readable outputs**
  Ensure override decisions are visible to operators and automation so duplicate exceptions can be reviewed and governed.
  - Rex status/output surfaces an indicator for items created via force-create override
  - JSON outputs include override marker fields without breaking existing schema consumers
  - Output clearly differentiates override-created items from merged or normal additions

**Interactive Duplicate Override Decision Flow**
- Implement merge-path application for user-selected duplicate proposals
  Allow users to keep PRD quality high by merging duplicate proposals into existing nodes instead of creating parallel items.
  - Selecting Merge updates the matched existing node rather than creating a new duplicate node
  - Merged result preserves existing node identity and records which proposal was merged
  - Cancelled proposals are not written when user chooses Merge for only a subset
- Implement force-create path that bypasses duplicate block after explicit confirmation
  Support intentional duplication for edge cases by allowing users to proceed anyway, while making the action explicit and auditable.
  - Selecting Proceed anyway creates new items even when duplicate reasons are present
  - Force-create requires explicit selection from the duplicate prompt and is never the default path
  - Choosing Cancel exits without writing any new or merged items

- Duplicate Detection and Reason Classification *(feature)*
  Identify when generated add proposals overlap with existing or completed PRD items and produce clear, user-facing duplicate reasons before any write occurs.
- Interactive Duplicate Override Decision Flow *(feature)*
  Require explicit user confirmation when duplicates are detected, with clear choices to cancel, merge with existing work, or force-create anyway.
- Force-create Auditability and Visibility *(feature)*
  Persist and expose override markers so intentionally duplicated items can be traced later in CLI output and downstream tools.
- Documentation and Test Coverage for Duplicate Overrides *(feature)*
  Document the new behavior and lock it in with regression tests across detection, prompt decisions, and persistence.

### Enhanced Rex Recommend Selective PRD Creation

**Documentation and Testing**
- Update CLI help and documentation for enhanced recommend --accept syntax
  Document the new selector syntax options and provide clear usage examples for selective PRD creation
  - Updates `rex recommend --help` with new selector syntax examples
  - Documents difference between acknowledge and accept workflows
  - Includes examples for single index, comma-separated, and wildcard selectors
  - Explains PRD creation behavior vs acknowledgment-only behavior
- Add comprehensive test coverage for enhanced recommend acceptance
  Test all selector syntax variations, PRD creation workflows, and error scenarios to ensure robustness
  - Tests comma-separated index parsing and validation
  - Tests period wildcard syntax and edge cases
  - Tests PRD creation from selected recommendations
  - Tests conflict detection and resolution workflows
  - Tests error handling for malformed selectors and invalid indices

**Enhanced Validation and Error Handling**
- Implement comprehensive selector validation with detailed error messages
  Validate selector format, index bounds, and recommendation availability with actionable error messages
  - Validates selector format matches expected patterns (=index, =1,3,5, or =.)
  - Checks all specified indices exist in current recommendations
  - Provides specific error messages for malformed selectors with correction hints
  - Handles edge cases like empty recommendation lists gracefully
- Add PRD creation conflict detection and resolution
  Detect and handle conflicts when selected recommendations would create duplicate or conflicting PRD items
  - Detects duplicate PRD items that would be created from recommendations
  - Provides merge options for conflicting recommendations
  - Allows user to skip conflicting items and proceed with non-conflicting ones
  - Maintains PRD consistency when handling partial creation scenarios

**Extended Selector Syntax Parsing**
- Implement comma-separated index list parsing for recommend --accept
  Extend the existing `=index` syntax to support `=1,3,5` format for selecting multiple specific recommendations by index
  - Parses `--accept=1,3,5` to select recommendations at indices 1, 3, and 5
  - Validates all indices are within bounds of available recommendations
  - Returns meaningful error for invalid index formats or out-of-range indices
- Implement period wildcard syntax for accepting all recommendations
  Add support for `=.` syntax to accept all available recommendations at once without listing individual indices
  - Parses `--accept=.` to select all available recommendations
  - Works correctly when no recommendations are available (no-op behavior)
  - Provides clear confirmation message showing total count of selected items

**PRD Creation Integration**
- 🔶 **Implement selective PRD creation from selected recommendations**
  Create PRD items from the selected recommendations using the existing rex add pipeline, replacing the acknowledge-only behavior
  - Creates actual PRD items (epics/features/tasks) from selected recommendations
  - Uses existing rex add validation and creation logic
  - Preserves recommendation metadata and quality scores in created items
  - Updates PRD state atomically to prevent partial creation on errors
- Add creation confirmation and summary output
  Provide clear feedback showing which recommendations were selected and successfully created as PRD items
  - Shows summary of selected recommendations before creation
  - Displays creation results with success/failure status per item
  - Includes PRD item IDs and hierarchy placement for created items
  - Shows total count of created vs selected items

- Extended Selector Syntax Parsing *(feature)*
  Extend the existing equals-prefixed index selector to support comma-separated lists and period wildcard for all items
- PRD Creation Integration *(feature)*
  Implement the actual PRD creation workflow for selected recommendations, going beyond the existing acknowledge functionality
- Enhanced Validation and Error Handling *(feature)*
  Robust validation for the extended selector syntax and PRD creation workflow
- Documentation and Testing *(feature)*
  Comprehensive documentation and test coverage for the enhanced recommendation acceptance workflow

### Git Credential Helper Opt-In Recovery

**Credential Helper Command Surface**
- Add opt-in git credential helper command to CLI
  Create a dedicated command users can run on demand to diagnose and set up git credentials, so remediation is explicit and repeatable instead of embedded in normal refresh execution.
  - Running the command starts a credential setup workflow only when explicitly invoked
  - The command is discoverable in CLI help output with usage and examples
  - Command exits with code 0 on successful setup checks and non-zero on unrecoverable setup errors
- Implement provider-aware auth checks and login handoff
  Support practical setup paths by checking `gh auth status` when GitHub CLI is available and providing platform credential-manager guidance when it is not, reducing manual troubleshooting.
  - If `gh` is installed, workflow runs `gh auth status` and offers `gh auth login` handoff when unauthenticated
  - If `gh` is not installed, workflow returns OS-specific credential setup guidance text
  - Workflow output distinguishes between authenticated, unauthenticated, and tool-unavailable states

**Non-Interactive Refresh Compatibility**
- 🔶 **Classify git auth failures and attach opt-in remediation hints**
  When refresh fails due to credential or auth issues, return a specific failure classification with a clear suggestion to run the new helper command instead of generic git errors.
  - Auth-related fetch failures map to a dedicated error classification distinct from network/history failures
  - Failure payload includes the exact opt-in helper command users should run next
  - Non-auth git failures do not include credential-helper remediation hints
- 🔶 **Enforce non-interactive default behavior in refresh path**
  Ensure refresh never opens interactive credential flows unless explicitly requested, preventing hangs in CI and preserving existing automation behavior.
  - Default refresh execution does not invoke `gh auth login` or any interactive credential prompt
  - Interactive helper flow runs only through explicit user opt-in command or explicit opt-in flag
  - Integration tests verify CI-like non-TTY refresh continues to fail fast with actionable guidance

- Credential Helper Command Surface *(feature)*
  Provide an explicit, user-invoked path to set up git credentials after authentication-related refresh failures without introducing interactive prompts into default flows.
- Non-Interactive Refresh Compatibility *(feature)*
  Integrate credential helper guidance into failure handling while preserving default non-interactive behavior for automated and scripted refresh runs.

### Git-Independent PR Markdown Generation

**Branch-Scoped Work Evidence Pipeline**
- 🔶 **Implement branch-scoped Rex work item collector**
  Build a collector that selects epics, features, and tasks relevant to the current branch from Rex state so PR summaries are grounded in planned and completed work, not git remote reachability.
  - Collector returns only Rex items associated with the active branch context
  - Collector excludes deleted items and includes status and completion timestamps when present
  - Unit tests cover mixed-branch datasets and verify no cross-branch leakage
- 🔶 **Implement branch-scoped Hench run evidence collector**
  Add a run evidence layer that gathers executed-task context from Hench runs tied to the active branch so generated PR markdown reflects actual execution history.
  - Collector returns Hench runs linked to the active branch and related Rex task IDs
  - Collector surfaces run outcomes and timestamps for summary generation
  - Integration tests validate correct filtering when runs exist for multiple branches
- 🔶 **Replace git-remote dependency in PR markdown refresh flow**
  Refactor the refresh pipeline to use the Rex/Hench branch evidence collectors as the primary and required data source, eliminating dependency on external git repository connectivity.
  - PR markdown refresh completes successfully when remote git fetch is unavailable
  - Refresh path does not invoke remote connectivity checks in normal generation mode
  - Regression tests confirm markdown generation is deterministic from Rex/Hench evidence only

**Work-History Narrative Synthesis**
- Generate PR sections from executed Rex tasks grouped by epic
  Create structured markdown sections that group completed branch work by epic and feature so reviewers can quickly understand scope and intent.
  - Generated markdown includes epic headings and task-level bullet summaries
  - Only completed or explicitly executed tasks are included in the default narrative
  - Snapshot tests verify stable section ordering across repeated runs
- Attach execution evidence badges to summarized tasks
  Annotate summarized tasks with lightweight execution evidence from Hench (for example run status and timestamp) to improve trust in branch-history-based summaries.
  - Each summarized task shows execution evidence when matching Hench data exists
  - Tasks without execution evidence are clearly labeled as no run evidence
  - Tests validate badge rendering for success, failure, and missing-evidence cases

- Branch-Scoped Work Evidence Pipeline *(feature)*
  Make PR markdown generation rely on Rex and Hench artifacts from the active branch instead of repository diff connectivity.
- Work-History Narrative Synthesis *(feature)*
  Generate reviewer-ready PR markdown from completed Rex tasks and corresponding Hench execution history in a consistent structure.

### Hench Process Concurrency Management

**Execution Concurrency Controls**
- Implement configurable maximum concurrent hench processes
  Add configuration setting and enforcement logic to limit the number of simultaneously running hench processes to prevent memory exhaustion from unlimited concurrent execution
  - Configuration option for max concurrent processes (default: 3)
  - Process count tracking prevents spawning beyond limit
  - Returns meaningful error when limit reached
  - Integrates with existing hench configuration system
- Add execution queue for pending tasks when at concurrency limit
  Implement queuing system to hold task execution requests when maximum concurrent processes are already running, with FIFO scheduling and queue status visibility
  - Tasks queue automatically when concurrency limit reached
  - FIFO execution order with priority override support
  - Queue status visible via API and CLI
  - Graceful queue cleanup on shutdown
- Implement hench process pool with reuse to reduce memory overhead
  Create process pooling mechanism to reuse existing Node.js runtimes for multiple task executions instead of spawning fresh processes, reducing memory consumption per task
  - Process pool maintains warm Node.js runtimes
  - Task isolation maintained between reused processes
  - Memory usage reduced by 60%+ for sequential tasks
  - Pool cleanup and refresh on idle timeout

**Resource-Aware Execution Scheduling**
- Monitor system memory usage before spawning hench processes
  Add system memory monitoring to check available memory before allowing new hench process creation, preventing system-wide memory pressure
  - Real-time system memory usage detection
  - Configurable memory threshold for execution blocking
  - Memory check integrated into process spawn logic
  - Cross-platform memory monitoring (macOS, Linux, Windows)
- Implement memory-based execution throttling
  Add intelligent throttling that delays or rejects new hench executions when system memory usage exceeds safe thresholds, with graceful degradation
  - Automatic execution delay when memory usage > 80%
  - Execution rejection when memory usage > 95%
  - Throttling status exposed via API
  - User notification of memory-based delays
- Add task priority-based scheduling within resource constraints
  Implement task prioritization system that schedules high-priority tasks first when operating under resource constraints, with configurable priority levels
  - Task priority metadata captured and used for scheduling
  - High-priority tasks bypass normal queue position
  - Priority configuration via task tags or explicit priority
  - Priority override available for urgent tasks

- Execution Concurrency Controls *(feature)*
  Implement limits and queuing for concurrent hench task execution to prevent resource exhaustion
- Resource-Aware Execution Scheduling *(feature)*
  Implement memory monitoring and intelligent scheduling to prevent system resource exhaustion during hench task execution

### Hench Resource Monitoring and User Feedback

**Process Resource Tracking**
- Implement real-time hench process memory monitoring
  Add per-process memory usage tracking for running hench tasks with historical data collection and trend analysis
  - Individual process memory usage tracked in real-time
  - Memory usage history stored for analysis
  - Memory leak detection for long-running tasks
  - Process memory data exposed via API
- Track concurrent execution metrics and resource utilization
  Implement comprehensive metrics collection for concurrent process count, total memory usage, and resource utilization patterns across hench executions
  - Real-time concurrent process count tracking
  - Total memory utilization across all hench processes
  - Resource utilization metrics (CPU, memory) per task
  - Metrics available via API for dashboard consumption
- Add process lifecycle and resource cleanup validation
  Implement validation and monitoring to ensure hench processes properly release resources on completion and detect resource leaks or orphaned processes
  - Process termination validation with resource cleanup checks
  - Orphaned process detection and automatic cleanup
  - Resource leak alerts for processes exceeding memory thresholds
  - Process lifecycle audit trail for debugging

**UI Resource Visibility and Controls**
- Display concurrent execution count and limits in Hench UI
  Add real-time display of current concurrent hench executions, configured limits, and queue status to the Hench dashboard section
  - Current/max concurrent process count displayed prominently
  - Queue length and pending task count visible
  - Visual indicators for approaching resource limits
  - Updates in real-time via WebSocket or polling
- Show memory usage and system resource status in execution panel
  Integrate system memory usage, per-process memory consumption, and resource health indicators into the active execution monitoring panel
  - System memory usage percentage displayed
  - Individual task memory consumption shown
  - Resource health indicators (green/yellow/red status)
  - Memory pressure warnings visible to users
- Add manual execution throttling controls and emergency stop
  Implement user controls to manually adjust concurrency limits, pause new executions, and emergency stop all running processes when needed
  - Manual concurrency limit adjustment via UI
  - Pause/resume button for new task execution
  - Emergency stop all executions button with confirmation
  - Throttling status and control state clearly indicated

- Process Resource Tracking *(feature)*
  Implement comprehensive monitoring and tracking of hench process resource usage for visibility and management
- UI Resource Visibility and Controls *(feature)*
  Provide user interface elements to display resource usage, execution limits, and manual controls for hench process management

### Init-time LLM Onboarding and Authentication

**Interactive init banner and provider selection**
- 🔶 **Present interactive LLM provider selection screen**
  Add a user-friendly selection prompt during init that allows choosing `codex` or `claude` as the active provider.
  - Init prompt lists exactly `codex` and `claude` as selectable providers
  - Selecting an option persists provider config to project settings
  - If the user cancels selection, init exits with a clear non-zero termination message
- Render branded n-dx banner at init start
  Display a prominent, readable terminal banner before setup prompts so users immediately understand they are in the guided initialization flow.
  - Running `n-dx init` displays a banner before any configuration questions
  - Running `ndx init` displays the same banner output
  - Banner output is suppressed when init is run in non-interactive mode
- Persist selected provider through existing config pathway
  Write provider choice via the unified configuration system so downstream packages resolve the same active vendor without custom init-only state.
  - Selected provider is readable through existing config get command/path
  - Subsequent commands use the selected provider without additional flags
  - Automated test verifies both `codex` and `claude` selections persist correctly

**Provider authentication preflight during init**
- 🔶 **Implement provider-specific auth status checks**
  Run a provider-specific preflight command after selection to determine whether the current shell session is authorized for the selected LLM.
  - Selecting `codex` triggers the codex auth check command
  - Selecting `claude` triggers the claude auth check command
  - Check result is handled as pass/fail with deterministic branching and no uncaught errors
- 🔶 **Prompt provider-specific login command on auth failure**
  When preflight fails, show clear remediation with the exact login command for the chosen provider so users can complete setup immediately.
  - If codex auth check fails, init prints codex login instruction
  - If claude auth check fails, init prints claude login instruction
  - Prompt message includes next-step guidance and does not continue silently
- Add integration tests for authenticated and unauthenticated init flows
  Cover both provider branches with mocked auth outcomes to prevent regressions in setup logic and ensure login prompting behavior remains reliable.
  - Test suite includes pass/fail auth scenarios for both `codex` and `claude`
  - Authenticated flow completes init without login prompt
  - Unauthenticated flow emits expected provider-specific login prompt text

- Interactive init banner and provider selection *(feature)*
  Make `n-dx init`/`ndx init` guide first-time setup with a prominent terminal banner and a clear LLM provider picker so users can configure execution without manual config edits.
- Provider authentication preflight during init *(feature)*
  After provider selection, validate that the current terminal session is authenticated for that provider and guide users to the correct login command when needed.

### Interactive PRD Validation and Consistency Resolution

**Interactive parent-child inconsistency resolution**
- Add interactive prompts to rex validate for parent-child inconsistencies
  Update rex validate command to detect epicless features and present interactive resolution options, allowing users to choose between correlation recovery and safe deletion workflows
  - Detects features positioned at root level without parent epics during validation
  - Presents interactive prompt with correlation and deletion options
  - Maintains backward compatibility with existing non-interactive validation behavior
  - Handles user cancellation and invalid input gracefully
- Implement epic correlation recovery for orphaned features
  Build recovery workflow that analyzes epicless features and suggests appropriate parent epics based on content analysis and existing PRD structure, enabling automated reparenting with user approval
  - Analyzes feature content and suggests semantically similar parent epics
  - Ranks suggestions based on content similarity and structural fit
  - Successfully reparents features while preserving all metadata and relationships
  - Provides fallback options when no suitable parent epic is found

- Interactive parent-child inconsistency resolution *(feature)*
  Enhance existing rex validate and fix commands to detect parent-child structural inconsistencies and provide interactive resolution workflows for user-guided corrections

### Live PR Markdown in SourceVision UI

**Live Refresh and Graceful Degradation**
- 🔶 **Implement auto-refresh triggers for file and git diff changes**
  Update the tab content automatically when the working tree or diff baseline changes so users always see current PR text without manual refresh.
  - PR markdown refreshes automatically when tracked files change
  - PR markdown refreshes automatically when git status/diff output changes
  - Refresh logic debounces rapid changes to avoid duplicate renders
  - UI shows timestamp of last successful refresh
- Handle unavailable git data with explicit fallback states
  Prevent broken UI behavior when running outside a git repo or when git commands fail by showing actionable fallback messaging.
  - When git executable is missing, tab displays a clear unsupported-state message
  - When current directory is not a git repository, tab shows a no-repo message
  - When base branch cannot be resolved, tab still renders with partial metadata and warning
  - Error states do not crash SourceVision server or other tabs
- Add integration tests for refresh behavior and fallback scenarios
  Protect the new workflow against regressions by covering normal refresh, dirty state updates, and git failure paths end-to-end.
  - Integration test verifies markdown changes after simulated diff update
  - Integration test verifies dirty/untracked indicators update after status change
  - Integration test verifies fallback UI for non-git workspace
  - All new tests pass in existing test pipeline

**PR Summary Generation Pipeline**
- 🔶 **Implement PR markdown generator for current branch vs main**
  Create a generator that builds a structured markdown summary from git diff output so users can paste directly into pull requests without manual rewriting.
  - Generates markdown from `main...HEAD` comparison when git data is available
  - Includes sections for overview, changed files, and notable change summaries
  - Output is plain markdown text with no HTML-only formatting dependencies
  - Generator returns deterministic section order for identical git input
- Include explicit base branch and commit metadata in generated summary
  Ensure users can verify exactly what baseline the summary compares against by embedding branch and commit identifiers in the markdown header.
  - Markdown includes base branch name and base commit SHA
  - Markdown includes current HEAD commit SHA
  - When base resolution fails, markdown displays a fallback marker instead of empty values
  - Metadata appears at the top of the summary in a dedicated section
- Incorporate dirty and untracked file state into PR summary
  Expose local-only working tree changes so the summary reflects what users actually see before committing, reducing mismatch between UI and repository state.
  - Summary includes a section listing modified but unstaged files
  - Summary includes a section listing untracked files
  - Dirty/untracked sections are omitted or marked none when not present
  - Working tree state is refreshed from current git status at generation time

**SourceVision PR Markdown Tab Experience**
- ⚠️ **Add PR Markdown tab to SourceVision navigation and routing**
  Expose a first-class tab so users can find PR-ready output without leaving SourceVision or running separate commands.
  - Sidebar or section navigation includes a PR Markdown entry under SourceVision
  - Selecting the tab updates URL/hash routing consistently with existing patterns
  - Tab loads without breaking existing SourceVision views
  - Tab displays initial loading, success, and empty states
- Render copy-ready markdown preview with raw text access
  Provide a readable preview and direct raw markdown copy path so users can quickly transfer content into pull request descriptions.
  - UI shows rendered markdown preview and corresponding raw markdown text
  - Copy action places full raw markdown content on clipboard
  - Copied content preserves headings, lists, and code fences
  - Copy control provides visible success/failure feedback

- PR Summary Generation Pipeline *(feature)*
  Generate a reliable markdown PR summary from current branch changes against main, including clear base reference metadata.
- SourceVision PR Markdown Tab Experience *(feature)*
  Add a dedicated, easy-to-access UI surface in localhost that continuously presents the latest PR markdown and supports quick copy/paste workflows.
- Live Refresh and Graceful Degradation *(feature)*
  Keep PR markdown current as repository state changes, while failing safely when git context is unavailable.

### LLM Client Circular Dependency Resolution

**Circular Dependency Analysis and Planning**
- ⚠️ **Review sourcevision circular dependency findings for llm-client package**
  ## Findings

Sourcevision analysis (2026-02-24T05:11:49, git sha 536ec50) detected **4 circular dependency chains** in `packages/llm-client/src/`.

### Root Cycle

All 4 chains are sub-paths of a single root cycle:

```
provider-interface.ts → llm-types.ts → create-client.ts → api-provider.ts → provider-interface.ts
provider-interface.ts → llm-types.ts → create-client.ts → cli-provider.ts → provider-interface.ts
```

### Dependency Graph (pre-fix)

```
provider-interface.ts ──imports LLMVendor──→ llm-types.ts
       ↑                                          │
       │                              imports CreateClientOptions
       │                                          ↓
 api/cli-provider.ts ←──provides factory── create-client.ts
       │
       └──imports LLMProvider──→ provider-interface.ts
```

### The 4 Chains Reported

1. `api-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts`
2. `api-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts` (type import duplicate)
3. `provider-interface.ts → llm-types.ts → create-client.ts`
4. `cli-provider.ts → provider-interface.ts → llm-types.ts → create-client.ts`

### Affected Modules

- `provider-interface.ts` — LLMProvider interface + (was) LLMVendor consumer
- `llm-types.ts` — vendor-neutral types + (was) LLMVendor definition
- `create-client.ts` — Claude dual-provider factory
- `api-provider.ts` — Anthropic SDK provider
- `cli-provider.ts` — Claude CLI provider

### Root Cause

`provider-interface.ts` imported `LLMVendor` from `llm-types.ts`. `llm-types.ts` imported `CreateClientOptions` from `create-client.ts`. Both providers imported `LLMProvider` from `provider-interface.ts` to implement it. This formed a structural cycle even though all cross-layer imports were `import type`.

### Resolution (already applied in prior session)

`LLMVendor` was moved from `llm-types.ts` to `provider-interface.ts` as a self-contained definition. `llm-types.ts` re-exports it for backward compatibility. The `provider-interface.ts → llm-types.ts` import edge was eliminated, breaking all 4 chains. Zero circular dependencies remain.
  - All circular dependency cycles in llm-client are documented with affected modules
  - Dependency graph visualization shows current circular relationships
  - Root causes of each circular dependency are identified
- ⚠️ **Design dependency refactoring strategy for llm-client**
  ## Dependency Refactoring Strategy: llm-client Circular Dependency Resolution

### Problem Statement
Sourcevision identified 4 circular dependency chains in packages/llm-client, all rooted in one cycle:
  provider-interface.ts → llm-types.ts → create-client.ts → (api|cli)-provider.ts → provider-interface.ts

### Root Cause Analysis
The cycle formed through these steps:
1. provider-interface.ts imported LLMVendor from llm-types.ts
2. llm-types.ts imported CreateClientOptions (type) from create-client.ts
3. create-client.ts imported createApiClient/createCliClient from provider modules
4. Provider modules imported LLMProvider/ProviderInfo from provider-interface.ts

### Dependency Layer Hierarchy
The llm-client module has 7 distinct layers:
- Layer 0 (foundation): types.ts, exec.ts, output.ts, json.ts, help-format.ts, suggest.ts
- Layer 1 (interfaces): provider-interface.ts — generic LLMProvider contract
- Layer 2 (config): config.ts, llm-config.ts
- Layer 3 (providers): api-provider.ts, cli-provider.ts, codex-cli-provider.ts
- Layer 4 (factories): create-client.ts, llm-client.ts
- Layer 5 (management): provider-registry.ts, provider-session.ts
- Layer 6 (aggregation): llm-types.ts, public.ts

### Strategy: Type Relocation via Dependency Inversion
**Chosen approach**: Move LLMVendor from Layer 6 (llm-types.ts) to Layer 1 (provider-interface.ts), then re-export from llm-types.ts for backward compatibility.

**Rationale**:
- LLMVendor identifies which vendor a provider implements — it belongs with the provider interface contract
- provider-interface.ts is the lowest layer that uses the type (ProviderInfo.vendor: LLMVendor)
- Re-exporting from llm-types.ts ensures zero breaking changes for existing consumers

**Alternatives considered and rejected**:
1. Extract to vendors.ts (new file): Adds a new file for a two-value type union; hard to discover
2. Move CreateClientOptions to llm-types.ts: Makes llm-types.ts import from factories (wrong direction)
3. Use import type everywhere: Already applied but does not break structural/tool-detected cycles
4. Split provider-interface.ts: Over-engineering; the file is small and cohesive

### Modules Changed
- provider-interface.ts: +8 lines — define and export LLMVendor with explanatory comment
- llm-types.ts: +2 lines — import LLMVendor from provider-interface.ts and re-export it

### Backward Compatibility
- All consumers of LLMVendor from @n-dx/llm-client continue to work unchanged
- public.ts exports unchanged
- No changes required in dependent packages (hench, rex, sourcevision, web, claude-client)

### Verification
- 323/323 tests pass in @n-dx/llm-client after the fix
- Runtime import graph: no circular dependencies remain
- Type-only imports (import type) form no runtime cycles and are safe
- Sourcevision circular dependency chain count: 4 → 0
  - Refactoring plan specifies which modules to split or merge
  - Strategy identifies shared abstractions to extract
  - Plan maintains backward compatibility for public API
  - Approach minimizes impact on dependent packages

**Dependency Refactoring Implementation**
- ⚠️ **Update package exports to maintain public API compatibility**
  Ensure that public API exports remain consistent after internal restructuring, updating index files and package.json exports as needed
  - All public exports remain available at same paths
  - Package.json exports configuration is updated correctly
  - No breaking changes to external consumers
  - Internal reorganization is transparent to users
- Extract shared types and interfaces to break circular dependencies
  Circular dependencies fully resolved. LLMVendor moved to provider-interface.ts (commit 0862f2d). All 4 cycles broken. TypeScript passes (0 errors). 323 tests pass. Public API unchanged via re-export.
  - All shared types are moved to non-circular locations
  - Type imports no longer create circular references
  - Public API surface remains unchanged
  - All existing type references are updated
- Reorganize module imports to follow dependency hierarchy
  Restructure imports within llm-client to ensure unidirectional dependency flow, potentially splitting large modules or creating new abstraction layers
  - All modules follow clear dependency hierarchy
  - No circular imports remain in the package
  - Module responsibilities are clearly separated
  - Import structure supports maintainability
- Log *(subtask)*

**Validation and Testing**
- 🔶 **Validate circular dependency resolution with sourcevision re-analysis**
  Run sourcevision analysis again on the refactored llm-client package to confirm all circular dependencies have been eliminated and no new issues were introduced
  - Sourcevision analysis shows zero circular dependencies in llm-client
  - No new architectural issues are introduced
  - Dependency graph shows clean unidirectional flow
  - Analysis report confirms resolution of all identified cycles
- 🔶 **Execute comprehensive test suite to ensure functionality preservation**
  Test results: llm-client 323/323 tests pass. claude-client 211/211 tests pass. hench 912/912 tests pass (after fixing stale help text assertion). rex 2291/2300 tests pass (after fixing modify-reason.test.ts mock to use createLLMClient/detectLLMAuthMode). Pre-existing failures noted: feature-filtered-task.test.ts (9 failures for unimplemented featureId filter, commit 90442f0 Feb 13 2026) and sourcevision cli-serve.test.ts (1 e2e timeout, environment limitation). Commit: 3a5556b
  - All llm-client unit tests pass without modification
  - All dependent package tests continue to pass
  - Integration tests verify cross-package functionality
  - No runtime errors are introduced by refactoring
- Update package documentation to reflect new internal structure
  Revise internal documentation and code comments to reflect the new module organization and dependency structure while keeping public API documentation unchanged
  - Internal architecture documentation is updated
  - Code comments reflect new module responsibilities
  - Public API documentation remains accurate
  - Developer onboarding docs reflect new structure

- Circular Dependency Analysis and Planning *(feature)*
  Analyze sourcevision findings to understand circular dependency structure and plan resolution approach
- Dependency Refactoring Implementation *(feature)*
  Execute the planned refactoring to eliminate circular dependencies through code restructuring
- Validation and Testing *(feature)*
  Verify that circular dependencies are resolved and functionality is preserved through comprehensive testing

### Memory-Aware Polling Loop Management

**Memory Pressure Polling Suspension**
- Wire memory pressure flag to loader polling suspension
  Connect the existing isFeatureDisabled(autoRefresh) flag to call stopPolling() in loader.ts when memory pressure reaches 50% threshold
  - Loader 5s polling stops when isFeatureDisabled(autoRefresh) returns true
  - stopPolling() function is invoked from memory degradation system
  - Loader polling remains stopped until memory pressure subsides
- Suspend status indicator polling during memory pressure
  Stop the 10s status-indicator polling loop when memory pressure is detected to minimize background processing
  - Status indicator polling stops when isFeatureDisabled(autoRefresh) is true
  - No status update requests during memory pressure
  - Status indicator shows last known state without updates

**Memory-Aware Polling Validation**
- Add integration tests for memory-aware polling suspension
  Create tests that simulate memory pressure conditions and verify all polling loops are properly suspended and restarted
  - Tests verify all three polling loops stop under simulated memory pressure
  - Tests confirm polling restart when memory pressure clears
  - Tests validate no resource leaks during suspension/restart cycles
- Add polling suspension status indicators
  Display UI indicators when polling is suspended due to memory pressure to inform users of degraded functionality
  - Visual indicator shows when polling is suspended due to memory pressure
  - Indicator explains why auto-refresh is disabled
  - Manual refresh options remain available during suspension

**Polling Restart and Recovery Logic**
- Add polling state management and cleanup
  Implement centralized polling state management to prevent orphaned intervals and ensure clean suspension/restart cycles
  - All polling intervals are tracked and can be cleanly stopped
  - No memory leaks from orphaned polling intervals
  - Polling state persists across component remounts during memory pressure

- Memory Pressure Polling Suspension *(feature)*
  Integrate memory pressure detection with active polling loops to prevent resource consumption during high memory usage
- Polling Restart and Recovery Logic *(feature)*
  Implement automatic polling restart when memory pressure subsides to restore normal UI functionality
- Memory-Aware Polling Validation *(feature)*
  Add testing and monitoring to ensure polling suspension works correctly under memory pressure scenarios

### ndx Dashboard Refresh Orchestration

**Dashboard Data and PR Markdown Refresh Flow**
- 🔶 **Implement SourceVision-derived dashboard artifact refresh step**
  Add orchestration logic that refreshes generated dashboard artifacts used by the web UI so analysis-derived views stay synchronized with repository state.
  - Default `ndx refresh` runs a data refresh step for SourceVision-derived dashboard artifacts.
  - `ndx refresh --data-only` runs data refresh steps without running UI build steps.
  - A successful run updates artifact timestamps or metadata that can be inspected after completion.
- Integrate PR markdown cache refresh into `ndx refresh` flow
  Wire PR markdown generation/cache refresh into the orchestration pipeline so users can refresh copy-ready PR content from one command.
  - Default `ndx refresh` includes PR markdown cache refresh as part of data refresh.
  - `ndx refresh --pr-markdown` triggers PR markdown cache refresh and skips unrelated steps.
  - If PR markdown refresh fails, command marks that step failed and returns non-zero status while preserving prior step results in output.

**Live Server Compatibility and Operator Feedback**
- Implement running-server detection and live reload signaling during refresh
  Detect active dashboard server context and send reload notifications where supported so users do not need to manually restart after routine refresh operations.
  - When `ndx start` server is running and reload signaling is supported, `ndx refresh` emits a live-reload signal after successful refresh steps.
  - Command output indicates whether live reload was attempted and whether it succeeded.
  - When no server is running, refresh completes without reload errors.
- Add stepwise status reporting and restart fallback guidance
  Provide clear per-step status output and explicit fallback instructions when a full restart is required, reducing ambiguity for operators and CI logs.
  - Each refresh step prints status transitions (started, succeeded, failed, skipped) with step names.
  - When hot reload is unavailable, output includes a restart-required message with the exact restart command.
  - User-facing docs include a `ndx refresh` section describing flags, live reload behavior, and restart fallback conditions.

**Refresh Command Surface and Execution Planning**
- 🔶 **Add `ndx refresh` command to CLI orchestration entrypoint**
  Expose a dedicated refresh command in the top-level CLI so dashboard refresh workflows are accessible without package-specific commands, reducing operator friction and script complexity.
  - `ndx refresh --help` shows the command with supported flags `--ui-only`, `--data-only`, `--pr-markdown`, and `--no-build`.
  - Running `ndx refresh` executes without unknown-command errors from a configured project root.
  - Command exits with code `0` on successful completion and non-zero on any failed step.
- 🔶 **Implement refresh plan builder for flag combinations and conflicts**
  Translate flag combinations into explicit step plans so each invocation has predictable behavior and invalid combinations are rejected before work starts.
  - `--ui-only` skips data refresh steps and executes only UI-related steps.
  - `--data-only` skips UI build steps unless explicitly required by implementation constraints and reports that decision.
  - `--pr-markdown` runs only PR markdown cache refresh path (plus required prerequisites) and skips unrelated steps.
  - `--ui-only` with `--data-only` returns a validation error with actionable guidance.

**UI Build and Asset Refresh Orchestration**
- Implement affected UI package resolver with `@n-dx/web` minimum coverage
  Create build-step resolution that always includes `@n-dx/web` and includes SourceVision-related assets when refresh scope indicates they are needed, preventing stale dashboard views.
  - Default `ndx refresh` includes build execution for `@n-dx/web`.
  - When SourceVision UI assets are required, resolver includes the SourceVision asset build step in the plan.
  - Plan output lists exactly which packages/assets will be built before execution.
- Apply `--no-build` and `--ui-only` semantics to build pipeline execution
  Respect user intent to skip build work or focus on UI work while keeping behavior explicit and safe for automation and local use.
  - `ndx refresh --no-build` skips all build commands and reports build steps as skipped.
  - `ndx refresh --ui-only` executes UI build/asset steps and does not run non-UI data refresh steps.
  - When both `--ui-only --no-build` are provided, command performs no build actions and still prints a valid step summary.

- Refresh Command Surface and Execution Planning *(feature)*
  Introduce a first-class `ndx refresh` command that turns user intent into a deterministic refresh plan across build and data steps.
- UI Build and Asset Refresh Orchestration *(feature)*
  Ensure dashboard UI artifacts are rebuilt correctly, always covering `@n-dx/web` and conditionally rebuilding SourceVision assets when required.
- Dashboard Data and PR Markdown Refresh Flow *(feature)*
  Refresh SourceVision-derived dashboard data and explicitly support PR markdown cache regeneration within the same orchestration command.
- Live Server Compatibility and Operator Feedback *(feature)*
  Make refresh behavior compatible with active `ndx start` sessions by attempting live reload signaling and clearly documenting restart requirements when hot update is not possible.

### PR Build Pipeline and Code Quality Automation

**Bitbucket Pipeline Integration**
- Create bitbucket-pipelines.yml with PR validation workflow
  Configure Bitbucket Pipelines to automatically run the pr-check script on pull requests targeting the main branch
  - Pipeline triggers automatically on pull requests to main branch
  - Pipeline executes the pr-check npm script in proper Node.js environment
  - Pipeline caches node_modules and build artifacts for performance
  - Pipeline reports clear pass/fail status to Bitbucket with build logs
- Configure pipeline environment and dependency management
  Set up proper Node.js environment, dependency caching, and build artifact handling in Bitbucket Pipelines
  - Pipeline uses appropriate Node.js version matching development environment
  - Pipeline caches pnpm store and node_modules for faster subsequent builds
  - Pipeline handles pnpm installation and workspace setup correctly
  - Pipeline includes timeout and resource limit configuration

**Package.json PR Build Script**
- Add pr-check script to package.json with build and PRD validation orchestration
  Create a comprehensive PR validation script that runs build checks and Rex PRD validation to prevent broken or incomplete work from being merged
  - Script runs `pnpm build` and fails if TypeScript compilation fails
  - Script runs `rex validate` and fails if orphaned epics or tasks are detected
  - Script exits with proper codes (0 success, 1 failure) for CI integration
  - Script provides clear error messages and diagnostics for all failure modes
- Implement Rex PRD orphan detection for PR validation
  Extend Rex validation to detect orphaned epics and tasks that would indicate incomplete work being merged
  - Detects epics with no child features or tasks
  - Detects tasks that are not properly nested under epics or features
  - Reports specific orphaned items with IDs, titles, and structural issues
  - Integrates with existing rex validate command structure

- Package.json PR Build Script *(feature)*
  Create a comprehensive PR validation script that combines build checking with PRD quality validation
- Bitbucket Pipeline Integration *(feature)*
  Configure Bitbucket Pipelines to automatically execute PR quality checks

### PR Markdown Reviewer Context Enrichment

**PRD Epic Attribution in PR Summaries**
- 🔶 **Implement branch-to-PRD work item resolver**
  Create a resolver that maps branch changes to completed or in-progress PRD tasks and derives their parent epic titles, so PR summaries can show intent-level context instead of only code-level changes.
  - Given a branch with linked PRD task activity, resolver returns unique parent epic titles
  - Resolver excludes deleted PRD items and items not touched by branch work
  - Resolver output is deterministic across repeated runs on the same git/PRD state
- Render worked-on epic titles in PR markdown overview
  Add a dedicated section near the top of generated PR markdown that lists PRD epic titles worked on by the branch, so reviewers immediately see strategic scope.
  - Generated markdown includes a 'Worked PRD Epics' section when at least one epic is resolved
  - Epic titles are de-duplicated and presented in stable order
  - When no epic mapping exists, markdown shows a concise fallback message rather than an empty section

**Significant Change Narrative**
- 🔶 **Implement significant-function and feature highlight extraction**
  Add logic to identify newly added or materially changed high-impact functions and user-visible features, enabling summaries that focus on reviewer-relevant changes.
  - Extractor identifies added/modified exported functions and routes/components touched in the branch
  - Output includes concise rationale for why each highlight is significant
  - Low-signal refactors (e.g., rename-only or formatting-only diffs) are excluded from highlights
- Generate reviewer-first overview section without file/line enumerations
  Update markdown generation to present a compact narrative of important changes and explicitly avoid long file-by-file or line-by-line lists that reduce review clarity.
  - Default PR markdown contains an 'Important Changes' narrative section with feature/function summaries
  - Default output does not include exhaustive per-file change listings or line-count tables
  - Integration tests fail if generator reintroduces long file/line enumeration patterns in default mode

- PRD Epic Attribution in PR Summaries *(feature)*
  Connect branch work to PRD context so reviewers can quickly understand which planned initiatives the changes implement.
- Significant Change Narrative *(feature)*
  Shift PR markdown toward human-readable explanation of important functional and feature-level changes, minimizing noisy implementation detail.

### PR Markdown View Toggle and Copy UX

**Copy-to-Clipboard Workflow**
- Add one-click copy action for raw markdown content
  Implement a dedicated copy button that copies the full generated markdown to clipboard so users can paste directly into PR comments.
  - Clicking copy places the complete raw markdown text on the clipboard
  - Copy action is available in Raw mode without selecting text manually
  - Automated UI test verifies clipboard write call with exact markdown payload
- Render copy status and fallback guidance
  Show immediate success/error feedback for clipboard operations and provide fallback instructions when browser permissions block clipboard access.
  - Successful copy displays a visible confirmation message
  - Clipboard failures display an error message with manual copy guidance
  - Tests cover success and permission-denied clipboard scenarios

**Single-Pane Preview/Raw Toggle**
- Refactor PR markdown panel to single-pane mode
  Update the PR markdown tab layout so only one representation is shown at a time, reducing visual clutter and improving focus.
  - UI renders either Preview or Raw mode, never both simultaneously
  - Default mode is Preview after opening or refreshing the tab
  - Responsive tests confirm correct layout on mobile and desktop widths
- Implement explicit Preview/Raw toggle control with persisted state
  Add a clear toggle control so users can switch modes quickly, and persist their last-used mode during the session for convenience.
  - Toggle control switches mode without page reload
  - Selected mode persists across tab re-renders within the same session
  - Accessibility checks confirm keyboard navigation and ARIA state updates

- Single-Pane Preview/Raw Toggle *(feature)*
  Replace side-by-side rendering with a single-pane mode switch between rendered preview and raw markdown.
- Copy-to-Clipboard Workflow *(feature)*
  Provide a reliable one-click copy action for raw PR markdown with clear success and failure feedback.

### Process Lifecycle Management and Graceful Shutdown

**Graceful Shutdown Implementation**
- 🔶 **Implement unified signal handler with cascading cleanup**
  Implemented unified signal handler with cascading cleanup (commit cb60d1c). Changes: (1) packages/web/src/server/start.ts: extracted registerShutdownHandlers() as an exported testable function with 30s overall timeout (configurable via N_DX_SHUTDOWN_TIMEOUT_MS env var), double-signal handling (second SIGINT/SIGTERM forces immediate exit(1) while graceful shutdown is still running), signal name in logs, and injectable exit dep for testing. The function runs cleanup in dependency order: hench child processes first then WebSocket connections then HTTP server then port file. (2) packages/web/tests/unit/server/shutdown-handler.test.ts: 13 new unit tests covering signal handler registration, cleanup ordering, SIGINT/SIGTERM name logging, double-signal force-exit, timeout force-exit, timeout error message, port file removal, and completion log.
  - Single signal handler coordinates shutdown across all processes
  - Cleanup procedures execute in proper dependency order
  - Timeout mechanisms prevent indefinite shutdown hangs
- 🔶 **Add process tree cleanup with force termination fallback**
  Implement comprehensive child process cleanup that gracefully terminates processes with force-kill fallback for unresponsive processes
  - All child processes are gracefully terminated on shutdown
  - Force termination kicks in after configurable timeout
  - Process tree is fully cleaned up before main process exits
- 🔶 **Implement port cleanup and resource release procedures**
  Add explicit port unbinding and resource cleanup procedures that execute during graceful shutdown to prevent port conflicts
  - All bound ports are explicitly released on shutdown
  - File handles and system resources are properly closed
  - Cleanup procedures log success/failure status
- Add shutdown status reporting and verification
  Implement status reporting during shutdown process and verification that cleanup completed successfully
  - Shutdown progress is logged with component-specific status
  - Cleanup verification confirms all processes terminated
  - Failed cleanup attempts are logged with diagnostic information

**Lingering Process Investigation and Root Cause Analysis**
- Audit current dashboard process spawning and lifecycle management
  Analyze all process creation points in the dashboard startup flow, including child processes, worker threads, and port bindings to understand the current architecture
  - Complete inventory of all processes spawned during dashboard startup
  - Documentation of current cleanup procedures and signal handlers
  - Identification of processes that lack proper cleanup
- Identify and catalog all port bindings and resource allocations
  Map all network ports, file handles, and system resources allocated during dashboard operation to understand what needs cleanup
  - Complete list of all ports bound during dashboard operation
  - Inventory of file handles and system resources allocated
  - Documentation of current resource cleanup procedures
- Analyze signal handling and termination procedures across all packages
  Review current SIGINT, SIGTERM, and other signal handling implementations across web, hench, rex, and sourcevision packages
  - Audit of all existing signal handlers in the codebase
  - Documentation of cleanup procedures triggered by signals
  - Identification of packages lacking proper signal handling
- Fix GAP-1: export shutdownRexExecution from routes-rex.ts and wire into start.ts gracefulShutdown *(subtask)*

**Refresh Command Process Management**
- Add pre-refresh process conflict detection and resolution
  Implement detection of existing dashboard processes during refresh and provide automated cleanup before proceeding with refresh operations
  - Existing dashboard processes are detected before refresh starts
  - Automated cleanup procedures terminate conflicting processes
  - Refresh proceeds only after successful cleanup verification
- Implement robust port availability checking with retry logic
  Implemented robust port availability checking with retry logic (commit d955530). Added checkPortWithRetry() to packages/web/src/server/port.ts with configurable exponential backoff (maxRetries, retryDelayMs, backoffFactor). Updated findAvailablePort() to accept optional retryOpts parameter (backward compatible). Wired retry options into startServer() in start.ts (maxRetries=5, retryDelayMs=100, backoffFactor=2) so recently stopped server ports get up to ~3s to clear before fallback. Exported new API from server/index.ts and public.ts. Added 6 new tests covering: immediate success, retry-and-succeed on port release, exhausted retries, maxRetries=0 edge case, findAvailablePort with retryOpts recovering preferred port, and fallback after exhausted retries. All 15 port tests pass. Pre-existing failures noted: sidebar.test.ts (localStorage mock env issue) and routes-hench.ts TS error (killWithFallback import) are both pre-existing.
  - Port availability is verified before attempting to bind
  - Retry logic handles timing issues during process transitions
  - Clear error messages provided when ports remain unavailable
- Add refresh operation cleanup validation and rollback
  Implement validation procedures that verify successful refresh completion and provide rollback mechanisms for failed refresh attempts
  - Refresh success is validated before marking operation complete
  - Rollback procedures restore previous state on failure
  - Clear status reporting throughout refresh lifecycle

- Lingering Process Investigation and Root Cause Analysis *(feature)*
  Systematically investigate and diagnose the root causes of lingering processes that remain active after dashboard termination or refresh commands
- Graceful Shutdown Implementation *(feature)*
  Implement comprehensive graceful shutdown procedures that properly clean up all processes, ports, and resources when dashboard is terminated
- Refresh Command Process Management *(feature)*
  Enhance the ndx refresh command to properly detect and clean up existing dashboard processes before starting refresh operations

### Rex Task and Epic Deletion Functionality

**Backend Deletion API Implementation**
- 🔶 **Implement remove epic function in rex core**
  Create core function to safely remove an epic from the PRD structure, handling child tasks and maintaining data integrity
  - Function removes epic and all child features/tasks from PRD tree
  - Maintains referential integrity of remaining PRD items
  - Returns success/failure status with descriptive error messages
  - Validates epic exists before attempting removal
- ⚠️ **Implement remove task function in rex core**
  Create core function to safely remove individual tasks from the PRD structure while preserving parent-child relationships
  - Function removes task from parent feature/epic
  - Updates parent completion status if needed
  - Handles task dependencies and blocked relationships
  - Validates task exists before attempting removal
- Audit existing remove functionality in rex codebase
  Search through rex package source code and CLI commands to identify any existing remove/delete functions for epics and tasks
  - Complete scan of rex package reveals all existing deletion functions
  - Documentation of current deletion capabilities or confirmation none exist
  - Clear assessment of what deletion functionality needs to be implemented
- Add deletion commands to rex CLI
  Expose remove functionality through rex CLI commands with proper validation and confirmation prompts
  - rex remove epic <id> command removes specified epic
  - rex remove task <id> command removes specified task
  - Commands include confirmation prompts for safety
  - Commands provide clear success/failure feedback
- Build complete search backend infrastructure
  Create comprehensive search system including REST endpoints, searchable index of PRD content, and query processing with relevance scoring for fast text matching across all PRD items
  - GET /api/search endpoint accepts query parameter and returns JSON results
  - Search results include item ID, title, description, and relevance score
  - Response time under 200ms for typical PRD sizes (1000+ items)
  - Supports search across epics, features, tasks, and subtasks
  - Index includes item titles, descriptions, and acceptance criteria text
  - Index updates automatically when PRD items are modified
  - Supports fuzzy matching and partial word matching
  - Index rebuild completes in under 5 seconds for large PRDs
  - Supports exact phrase matching with quotes
  - Ranks results by relevance (title matches higher than description)
  - Handles multi-word queries with AND/OR logic
  - Returns results sorted by relevance score descending

**Documentation and Help Updates**
- Update README with deletion command documentation
  Add comprehensive documentation for new deletion commands to the project README, including usage examples and safety warnings
  - README includes rex remove epic command usage
  - README includes rex remove task command usage
  - Documentation includes safety warnings about irreversible deletions
  - Examples show proper command syntax and confirmation flows
- Update CLI help text for deletion commands
  Ensure rex CLI help system includes comprehensive help text for the new remove commands
  - rex help shows remove commands in command list
  - rex help remove provides detailed usage instructions
  - Help text explains difference between removing epics vs tasks
  - Help includes warnings about data loss and confirmation requirements

**Rex UI Deletion Interface**
- Add delete buttons to Rex UI task and epic items
  Integrate delete buttons or context menu options into the Rex UI for both epics and tasks in the task tab view
  - Delete buttons visible on epic items in Rex task tab
  - Delete buttons visible on task items in Rex task tab
  - Buttons are clearly labeled and styled appropriately
  - Delete options accessible via right-click context menu
- Implement deletion confirmation dialog
  Create modal confirmation dialog that warns users about deletion consequences and requires explicit confirmation
  - Modal shows item title and type being deleted
  - Dialog warns about child items that will also be deleted
  - Requires explicit confirmation before proceeding
  - Provides cancel option to abort deletion
- Update UI state after successful deletions
  Ensure Rex UI refreshes and updates the task tree view in real-time after items are successfully deleted
  - Deleted items immediately disappear from UI tree
  - Parent completion percentages update if children deleted
  - Loading states shown during deletion API calls
  - Error messages displayed if deletion fails

- Backend Deletion API Implementation *(feature)*
  Build complete server-side search infrastructure including API endpoints, indexing system, and query processing with relevance scoring
- Rex UI Deletion Interface *(feature)*
  Add interactive deletion capabilities to the Rex web UI task tab with proper user confirmation flows
- Documentation and Help Updates *(feature)*
  Update project documentation to reflect the new deletion capabilities in both CLI and UI

### Rex Token Usage & LLM Utilization UX Overhaul

**Diagnostics, Fallbacks, and Test Coverage**
- Implement API and UI diagnostics for missing or partial provider usage metadata
  Add explicit status fields and user-facing diagnostic messaging when vendor/model/token metadata is missing so failures are observable and debuggable.
  - API responses include a diagnostic status when usage metadata is missing or partial
  - UI renders cause-specific fallback messages instead of silent zero values
  - Diagnostic state includes remediation hint for unavailable provider metadata
- Add codex and claude regression tests for parsing, aggregation, and budget percentages
  Create fixture-driven tests that validate vendor-specific payload parsing and end-to-end totals/percentages across tools and time windows.
  - Tests cover codex and claude payload variants including missing fields
  - Aggregation tests verify per-tool, per-vendor/model, task, and project totals
  - Percentage tests verify correct outputs for normal, zero-budget, and missing-budget scenarios

**Rex Dashboard IA and LLM Utilization View**
- Promote Token Usage to a top-level Rex dashboard section
  Reorganize navigation and routing so token usage is directly visible under Rex without being nested in secondary views.
  - Rex sidebar/nav shows Token Usage as a parent-level section
  - Existing deep links route to the new location without broken navigation
  - Navigation tests confirm active-state behavior for the new section
- Build LLM utilization dashboard grouped by configured vendor/model
  Add a dashboard view that combines current project configuration and recent run usage to show totals, trends, and per-tool breakdowns.
  - View displays totals by vendor/model for the selected time range
  - View displays trend data across recent periods and per-tool (rex/hench/sourcevision) breakdown
  - Displayed usage source and time window are visible in the UI

**Task-Level Usage Visibility and Budget Context**
- 🔶 **Repair task token tag binding to accumulated usage totals**
  Fix task metadata mapping so each task reflects real summed usage from associated runs rather than stale or defaulted values.
  - Task list and task detail views show identical token totals for the same task
  - Totals update after new runs without manual data edits
  - Tasks with no associated usage render explicit zero state instead of blank
- Display task-level weekly budget percentage in task chips and details
  Show each task’s share of weekly budget using vendor/model-aware percentages so users can identify high-cost work quickly.
  - Each task with usage shows percentage of weekly budget next to token count
  - Percentage uses the budget that matches the task’s vendor/model usage source
  - When budget is missing, UI shows deterministic fallback label and no invalid percentage

**Token Usage Data Pipeline Recovery**
- 🔶 **Implement unified usage event normalization across Rex, Hench, and SourceVision logs**
  Create a shared normalization path that converts vendor-specific usage payloads into one canonical shape so downstream aggregation is consistent.
  - Usage records from rex, hench, and sourcevision are ingested into a single normalized structure
  - Normalized records include vendor, model, tool, timestamp, and token totals when present
  - Records missing optional fields are still accepted with explicit null/default values
- 🔶 **Fix Rex token aggregation queries that return zero for tasks and dashboard totals**
  Correct the aggregation logic and joins/lookups so token totals resolve from normalized usage events to task-level and project-level views.
  - At least one fixture run with non-zero usage produces non-zero task totals in Rex
  - Dashboard project totals match the sum of the same-period task totals
  - Regression test fails on prior zero-count behavior and passes with fix

**Vendor/Model Budget Configuration and Percentage Engine**
- Add weekly budget config keys scoped by vendor and model
  Extend config schema and defaults to store weekly token allotments per provider/model combination, with validation and clear error messages.
  - Config accepts budget entries keyed by vendor and model
  - Invalid budget values or malformed keys are rejected with actionable validation errors
  - CLI/config readout shows resolved weekly budgets for active project
- Implement weekly percentage calculator for task and project utilization
  Compute usage percentages against configured weekly budgets using a deterministic time window and expose the result to API/UI consumers.
  - Task utilization percentage is computed from task token total divided by matching vendor/model weekly budget
  - Project utilization percentage is computed from summed weekly usage against summed applicable budgets
  - Calculation tests cover boundary cases including zero budget, missing budget, and week rollover

- Token Usage Data Pipeline Recovery *(feature)*
  Restore end-to-end token accounting so Rex task and dashboard usage values reflect real run data instead of zeroed counters.
- Vendor/Model Budget Configuration and Percentage Engine *(feature)*
  Support configurable weekly token budgets by vendor/model and compute utilization percentages for tasks and project rollups.
- Rex Dashboard IA and LLM Utilization View *(feature)*
  Promote token usage to a first-class Rex section and add a dedicated vendor/model utilization dashboard.
- Task-Level Usage Visibility and Budget Context *(feature)*
  Expose accurate accumulated token usage on each task, including budget-relative context to support prioritization decisions.
- Diagnostics, Fallbacks, and Test Coverage *(feature)*
  Provide explicit diagnostics for missing usage metadata and add comprehensive tests for parsing and utilization math.

### Rex Web UI Search Interface

**Search UI Components and Advanced Features**
- Add advanced search features and keyboard navigation

- Search UI Components and Advanced Features *(feature)*
  Create comprehensive user interface for search functionality including input components, results display, advanced filtering, and keyboard navigation

### Selective Recommendation Acceptance Syntax

**Indexed opt-in parsing for `recommend --accept`**
- 🔶 **Implement equals-prefixed index selector parsing for `recommend --accept`**
  Add command parsing support for values like `=1,4,5` so users can target specific recommendation indices without changing existing all-accept behavior.
  - Running `recommend --accept =1,4,5` parses indices as [1,4,5] when at least 5 recommendations exist
  - Parsing ignores surrounding whitespace in inputs like `=1, 4, 5`
  - Existing `recommend --accept` behavior without an equals selector remains unchanged
- 🔶 **Apply indexed selection to recommendation acceptance workflow**
  Wire parsed indices into the acceptance pipeline so only selected recommended items are accepted and persisted, preserving original recommendation ordering.
  - Only specified indices are accepted and written to PRD state
  - Unselected recommendations remain pending and are not mutated
  - Accepted items preserve the same relative order they had in the recommendation list

**Validation and UX messaging for selector input**
- Validate selector format and index bounds before applying acceptance
  Reject invalid selectors early to prevent unintended acceptance and ensure users receive deterministic errors for malformed syntax or unavailable indices.
  - Inputs without `=` when selector mode is expected return a format error with an example
  - Out-of-range indices (for example selecting 9 when only 8 exist) return a clear validation error
  - Duplicate indices are de-duplicated before execution or explicitly rejected with a consistent rule
- Add tests and help text for `=index` acceptance syntax
  Document the new selector option and cover it with automated tests so behavior remains stable across future CLI and workflow changes.
  - CLI help for `recommend --accept` includes an example using `=1,4,5`
  - Unit tests cover valid parsing, invalid syntax, out-of-range values, and mixed whitespace
  - Integration test verifies that selecting specific indices accepts only those recommendation items

- Indexed opt-in parsing for `recommend --accept` *(feature)*
  Allow users to accept only specific recommended items by providing an equals-prefixed index list (for example `=1,4,5`) instead of accepting all recommendations.
- Validation and UX messaging for selector input *(feature)*
  Provide clear guardrails and user feedback for malformed or out-of-range index selectors so partial acceptance is safe and predictable.

### SourceVision PR Markdown Artifact-Based Fallback Mode

**Fallback Output Semantics and Metadata**
- Render explicit fallback-mode labeling in generated PR markdown
  Prevent reviewer confusion by clearly marking markdown generated without git diff data and documenting the substitute evidence sources used.
  - Generated markdown includes a visible fallback mode label in the overview section
  - Markdown lists the evidence sources used (Rex, Hench) when present
  - Primary non-fallback markdown template remains unchanged when git diff succeeds
- Compute fallback confidence and coverage metrics from available evidence
  Quantify how complete and reliable the fallback summary is so reviewers can judge risk when git data is unavailable.
  - Coverage metric reports percentage of expected evidence sources found among configured fallback inputs
  - Confidence score decreases when required inputs are missing and increases when both Rex and Hench evidence are present
  - Metric outputs are deterministic for identical input artifacts
- Expose fallback metadata in refresh API and cached artifact payload
  Persist and return mode, confidence, and coverage fields so UI and downstream automation can distinguish fallback outputs programmatically.
  - Refresh API response includes mode, confidence, and coverage fields when fallback is used
  - Cached PR markdown artifact stores the same fallback metadata fields alongside content
  - Non-fallback responses explicitly report normal mode and do not include stale fallback metadata

**Fallback Trigger and Quality Regression Coverage**
- 🔶 **Add unit tests for fallback trigger classification across git failure modes**
  Protect routing logic by verifying that only intended preflight/fetch/diff failures activate fallback generation.
  - Tests cover at least preflight failure, fetch failure, and diff failure trigger paths
  - Tests assert non-git internal errors do not silently switch to fallback
  - All trigger classification tests pass in CI without network dependencies
- Add integration tests for fallback markdown labeling and metadata fields
  Validate end-to-end behavior so generated fallback markdown and API payloads remain reviewer-safe and machine-consumable.
  - Integration test asserts fallback markdown includes explicit mode label when diff generation is forced to fail
  - Integration test asserts API payload includes confidence and coverage metadata with valid numeric ranges
  - Integration test asserts successful git-diff path does not show fallback label

**Fallback Triggering and Orchestration**
- 🔶 **Implement git-failure fallback routing in PR markdown refresh pipeline**
  Route refresh execution to a fallback generator whenever preflight, fetch, or diff stages fail so the endpoint returns usable PR content instead of only an error state.
  - Given a simulated fetch failure, refresh returns HTTP success with fallback payload instead of aborting generation
  - Given a simulated diff-stage failure, refresh returns fallback payload and does not clear previously cached successful markdown
  - Fallback routing is only activated for classified git/preflight/diff failures and not for unrelated internal exceptions
- Extract branch-relevant completed Rex work items for fallback summaries
  Build a resolver that gathers completed epics/tasks associated with the active branch context so fallback output reflects actual delivered work.
  - Resolver returns completed Rex items scoped to the current branch context when mappings exist
  - Resolver excludes non-completed items from fallback summary inputs
  - When no branch-scoped Rex items are found, resolver returns an explicit empty-result signal consumed by fallback metadata
- Ingest Hench run artifacts into fallback summary input model
  Incorporate recent run artifacts as secondary evidence so fallback summaries include execution context when git diff evidence is unavailable.
  - Fallback input model includes Hench run identifiers and task associations when artifacts are present
  - Artifact parser tolerates missing or partial run fields without throwing
  - Fallback generator omits Hench section cleanly when no valid artifacts are available

- Fallback Triggering and Orchestration *(feature)*
  Ensure PR markdown generation still succeeds when git-based fetch or diff operations fail by switching to a deterministic artifact-based fallback path.
- Fallback Output Semantics and Metadata *(feature)*
  Make fallback output explicit, reviewable, and trustworthy by labeling mode and attaching measurable coverage and confidence signals.
- Fallback Trigger and Quality Regression Coverage *(feature)*
  Add automated tests validating fallback activation, output structure, and metadata correctness across key failure modes.

### SourceVision PR Markdown Git Preflight and Credential Diagnostics

**Pre-refresh Git Environment Validation**
- 🔶 **Implement repository state preflight before PR markdown refresh**
  Add a preflight step that verifies the working directory is a git repository and the current HEAD is attached to a branch before any diff or fetch operation runs.
  - Refresh flow runs repository-state preflight before invoking diff generation
  - When executed outside a git repository, response returns error code `NOT_A_REPO` and does not attempt diff/fetch
  - When HEAD is detached, response returns error code `DETACHED_HEAD` and includes current commit SHA in diagnostics
  - Unit tests cover success and both failure paths
- 🔶 **Add remote reachability and credential preflight checks**
  Proactively test remote connectivity and authentication so fetch-related issues are classified before refresh attempts fail with generic git errors.
  - Preflight performs a lightweight remote check against the configured base remote
  - Credential failures are classified as `FETCH_DENIED` when remote reports authorization/authentication rejection
  - Connectivity failures are classified as `NETWORK_DNS_ERROR` when DNS or transport connection fails
  - Refresh aborts before diff generation when remote or credential preflight fails
  - Tests cover auth-denied and network/DNS failure classification
- Validate base reference existence and shallow-clone readiness
  Ensure the configured base reference can be resolved locally and handle shallow history limitations before attempting branch comparison.
  - Preflight checks whether configured base ref resolves to a valid commit
  - If base ref is missing, response returns `MISSING_BASE_REF` with the unresolved ref name
  - If repository is shallow and lacks required history, response returns `SHALLOW_CLONE`
  - Integration tests simulate missing base ref and shallow clone scenarios with deterministic outcomes

**Targeted Remediation Contract for Preflight Failures**
- Define structured preflight error schema with remediation commands
  Extend refresh diagnostics contract to include stable failure codes, human-readable cause summaries, and command-ready remediation steps for each classified preflight error.
  - API response includes fields for `code`, `summary`, and `remediationCommands` on preflight failure
  - Each failure code in scope (`NOT_A_REPO`, `MISSING_BASE_REF`, `FETCH_DENIED`, `NETWORK_DNS_ERROR`, `DETACHED_HEAD`, `SHALLOW_CLONE`) maps to at least one remediation command
  - Schema validation fails when a preflight error is returned without remediation commands
  - Contract tests verify response shape for all scoped failure codes
- Replace generic PR markdown refresh git errors with classified preflight output
  Update refresh endpoint and PR Markdown UI messaging to prefer classified preflight diagnostics and hide low-signal raw git diff failure text.
  - When preflight fails, endpoint returns classified diagnostics and skips generic diff error wrapping
  - UI renders failure-specific remediation commands and does not display raw git stderr by default
  - Existing degraded-mode refresh behavior remains unchanged for non-preflight failures
  - Integration tests confirm targeted messaging appears for auth, network, and detached-head cases

- Pre-refresh Git Environment Validation *(feature)*
  Validate git prerequisites before PR markdown generation so refresh failures are detected early and reported with precise root causes.
- Targeted Remediation Contract for Preflight Failures *(feature)*
  Return actionable, error-specific remediation guidance so operators can recover quickly without inspecting raw git errors.

### SourceVision PR Markdown Quality & Manual Refresh

**Human-scoped PR Markdown Output**
- 🔶 **Redesign PR markdown template around scope, notable changes, and shoutouts**
  Establish a new output structure that leads with concise scope-of-work and key highlights so reviewers can understand intent quickly.
  - Generated markdown includes dedicated sections for Scope of Work, Notable Changes, and Shoutouts
  - Section order is consistent across runs
  - Template rendering succeeds when one or more sections have no items by showing an explicit fallback line
- 🔶 **Remove exhaustive per-file change tables from generated markdown**
  Reduce cognitive load by deleting detailed per-file tabular output and replacing it with concise grouped summaries.
  - Generated markdown contains no per-file change table blocks
  - Summary content is grouped by meaningful themes or workstreams instead of file paths
  - Regression test verifies old file-table markers are absent in output
- Add output quality guardrails for concise section length
  Prevent verbose output by enforcing practical limits and fallback behavior when generated sections become too long.
  - Each top-level summary section enforces a maximum item count or length limit
  - When truncation occurs, markdown includes an explicit note indicating truncation
  - Unit tests cover normal, empty, and over-limit section scenarios

**Manual Refresh-Only Generation Flow**
- 🔶 **Add SourceVision CLI command to refresh PR markdown on demand**
  Provide an explicit command entry point so users can regenerate PR markdown only when they choose.
  - New CLI command is available under SourceVision to refresh/regenerate PR markdown
  - Command exits with code 0 on success and non-zero on generation failure
  - Help output documents command purpose, usage, and expected output location
- 🔶 **Persist generated PR markdown and refresh metadata as cached artifact**
  Store generated content and metadata (including refresh timestamp and error state) so the UI can display stable results without recomputing.
  - Successful refresh writes markdown content and last-refreshed timestamp to cache
  - Failed refresh records an error state without deleting last successful content
  - Cache read path returns both content and metadata in a single model
- 🔶 **Remove automatic PR markdown refresh triggers from file and git change watchers**
  Eliminate background regeneration to make freshness explicit and predictable for users.
  - No automatic PR markdown regeneration occurs on file changes
  - No automatic PR markdown regeneration occurs on git diff changes
  - Integration test confirms output remains unchanged until a manual refresh action is invoked

**PR Tab Cached Display and Refresh UX**
- Render cached PR markdown content with last-refreshed timestamp in PR tab
  Ensure the tab shows the most recent generated artifact and metadata so users can trust what they are viewing.
  - PR tab loads cached markdown without triggering generation
  - UI displays a visible Last Refreshed timestamp from cache metadata
  - Timestamp formatting is consistent across reloads and navigation
- Implement explicit Refresh button in PR tab wired to manual regeneration endpoint
  Allow users to regenerate output from within the tab without relying on automatic background updates.
  - Refresh button invokes regeneration endpoint only on user click
  - UI shows in-progress state while refresh is running and disables duplicate clicks
  - On success, markdown content and last-refreshed timestamp update immediately
- Add stale, not-yet-generated, and refresh-error state views in PR tab
  Provide clear remediation guidance when content is outdated, missing, or generation fails.
  - Not-yet-generated state appears when no cached artifact exists and includes clear next action
  - Stale state appears when cache is older than defined threshold and prompts manual refresh
  - Refresh-error state shows error message plus option to retry without losing last successful output

- Human-scoped PR Markdown Output *(feature)*
  Refocus generated PR summaries on reviewer-friendly signal instead of exhaustive file-by-file noise.
- Manual Refresh-Only Generation Flow *(feature)*
  Replace automatic refresh behavior with explicit user-triggered regeneration via CLI and UI actions.
- PR Tab Cached Display and Refresh UX *(feature)*
  Update the SourceVision PR tab to show cached output and clear state messaging around freshness and failures.

### SourceVision PR Markdown Refresh Degraded-Mode Hardening

**PR Markdown UI messaging and regression coverage**
- Render degraded refresh banners with diagnostic-specific messaging
  Update PR Markdown tab messaging to display targeted degraded-state notices based on diagnostic codes while preserving cached markdown visibility.
  - UI shows cached markdown content when refresh response status is degraded
  - UI displays diagnostic-specific message variants for all supported codes
  - UI does not show generic refresh failure copy for classified degraded responses
- Surface remediation hints in PR Markdown refresh error panel
  Expose server-provided remediation hints directly in the PR Markdown tab so users can take immediate recovery actions.
  - When degraded response includes remediation hints, UI renders them as a visible actionable list
  - Hints are hidden when refresh succeeds or no hints are provided
  - Hint rendering is deterministic and preserves server-provided order
- Add integration tests for degraded refresh API and UI parity
  Prevent regressions by validating refresh behavior, diagnostics, cache retention, and UI messaging across all targeted failure classes.
  - API integration tests cover each classified failure code with cached markdown present and assert non-500 degraded responses
  - API tests assert cached markdown payload retention for degraded responses
  - UI integration tests assert diagnostic-specific messaging and remediation hint rendering for degraded responses

**Refresh endpoint degraded response parity**
- 🔶 **Implement degraded refresh response contract with cache retention**
  Ensure refresh returns a non-500 structured payload when generation fails for known git/base-branch conditions and cached markdown exists, so users keep usable output instead of losing access.
  - When cached markdown exists and refresh encounters a classified git/base-branch failure, the endpoint responds with HTTP 200 and a `degraded` status instead of HTTP 500
  - Response includes cached markdown content and last-refreshed metadata without mutation
  - Unhandled/unknown errors still return HTTP 500 with existing error envelope
- 🔶 **Add refresh failure classifier for git and base-branch resolution errors**
  Classify refresh failures into explicit diagnostic codes so clients can provide precise remediation guidance and avoid generic server-error messaging.
  - Classifier emits distinct codes for `missing_git`, `not_repo`, `unresolved_main_or_origin_main`, `fetch_failed`, `rev_parse_failed`, and `diff_failed`
  - Each classified code is propagated in refresh response diagnostics when triggered
  - Classifier is reused by refresh flow logic rather than duplicating ad-hoc string checks
- Attach actionable remediation hints to degraded diagnostics
  Provide operator-ready next steps in refresh responses so users can recover from degraded mode without reading logs or source code.
  - Each diagnostic code includes at least one remediation hint tailored to that failure mode
  - Hints are present in degraded refresh responses and omitted from successful refresh responses
  - Hints for unresolved base branch explicitly reference checking `main` and `origin/main` availability

- Refresh endpoint degraded response parity *(feature)*
  Make `/api/sv/pr-markdown/refresh` behave consistently with read/state endpoints by returning structured degraded responses when refresh prerequisites fail but cached markdown is available.
- PR Markdown UI messaging and regression coverage *(feature)*
  Align UI behavior and tests with degraded refresh responses so users see clear, cause-specific messaging while cached markdown remains available.

### SourceVision PR Markdown Tab Parity Hardening

**Endpoint Integration and Diagnostic States**
- 🔶 **Integrate PR Markdown view with data and state endpoints under a unified refresh loop**
  Use `/api/sv/pr-markdown` for content and `/api/sv/pr-markdown/state` for availability, with coordinated refresh behavior so UI state and markdown output stay in sync.
  - View fetches markdown content from `/api/sv/pr-markdown` and availability metadata from `/api/sv/pr-markdown/state`
  - Auto-refresh updates both state and markdown without requiring manual reload
  - When state reports unavailable, markdown fetch is skipped or safely handled to avoid repeated error spam
- 🔶 **Render cause-specific empty and error states with remediation guidance**
  Provide explicit messages and fix steps for known unavailability causes so users can self-resolve setup issues quickly.
  - UI shows a distinct message for 'not a git repository' with a concrete remediation step
  - UI shows a distinct message for 'unresolved base branch' with a concrete remediation step
  - UI shows a distinct message for 'wrong server/port or endpoint unreachable' with a concrete remediation step
  - Fallback error state handles unknown failures without exposing raw stack traces
- Add integration tests for PR Markdown tab parity and unavailable-state messaging
  Lock in behavior with end-to-end coverage for tab selection parity, route wiring, endpoint-driven refresh, and user-facing diagnostics.
  - Test verifies PR Markdown appears as a SourceVision sidebar tab and can be selected like existing tabs
  - Test verifies direct hash navigation to PR Markdown selects the correct tab and view
  - Test verifies unavailable-state messages for git repo, base branch, and server/port scenarios
  - Test verifies refresh loop updates displayed content when endpoint responses change

**Navigation and Routing Parity**
- 🔶 **Register PR Markdown in the shared SourceVision tab configuration**
  Centralize PR Markdown in the same tab metadata structure used by Import Graph and Zones so sidebar rendering and view wiring are driven by one source of truth.
  - PR Markdown appears in the SourceVision sidebar using the same tab component path as Import Graph and Zones
  - Tab metadata for PR Markdown is defined in the shared SourceVision tab config rather than ad-hoc conditional rendering
  - Selecting PR Markdown from the sidebar opens the PR Markdown view without requiring additional manual URL edits
- 🔶 **Normalize PR Markdown hash route parsing and tab selection state**
  Align PR Markdown route/hash handling with existing SourceVision views to prevent mismatches between URL, selected tab, and rendered content.
  - Loading the PR Markdown hash directly selects the PR Markdown tab and renders the PR Markdown view
  - Browser back/forward navigation updates both selected tab state and rendered panel correctly for PR Markdown
  - Unknown or malformed PR Markdown hashes fall back to the default SourceVision view without crashing

- Navigation and Routing Parity *(feature)*
  Make PR Markdown behave identically to first-class SourceVision tabs so navigation, selection, and deep-link behavior are consistent.
- Endpoint Integration and Diagnostic States *(feature)*
  Ensure PR Markdown data and availability state come from the dedicated APIs with clear, actionable UI feedback for unavailable scenarios.

### SourceVision Semantic Diff Determinism and Tooling-Drift Hardening

**Deterministic Semantic Diff Command Execution**
- 🔶 **Enforce deterministic non-interactive flags for semantic diff git invocations**
  Prevent local external diff drivers, textconv filters, or interactive paging from changing semantic diff behavior so refresh results stay consistent across environments.
  - Semantic diff extraction runs with `--no-ext-diff` and `--no-textconv` on every refresh path.
  - Semantic diff command execution is non-interactive and does not invoke a pager or prompt for input.
  - Integration test verifies identical semantic diff extraction behavior when local git config enables external diff/textconv.
- 🔶 **Split semantic diff and name-status diff execution into independently classified stages**
  Ensure a semantic diff failure does not get conflated with name-status collection so diagnostics and fallback decisions are accurate.
  - Semantic diff and name-status diff run as separate stage executions with distinct status fields.
  - A semantic diff failure with successful name-status diff returns a mixed-stage result instead of a single generic failure.
  - Regression test covers semantic-stage failure while name-status stage succeeds and validates separate classification output.

**Subcommand-Level Diagnostics and Remediation Surfacing**
- Include exact failing semantic diff subcommand metadata in refresh diagnostics
  Give operators precise visibility into which git subcommand failed so they can quickly reproduce and fix local tooling drift issues.
  - Refresh API error payload includes the failing semantic diff subcommand string and stage identifier.
  - Payload preserves stderr/exit-code context in structured fields suitable for UI rendering.
  - Sensitive values are redacted according to existing logging/error policies.

- Deterministic Semantic Diff Command Execution *(feature)*
  Make semantic diff extraction resilient to local Git config/tooling differences by forcing a stable, non-interactive command path.
- Subcommand-Level Diagnostics and Remediation Surfacing *(feature)*
  Expose actionable failure details for semantic diff drift scenarios in both API and UI without losing usable cached output.

### SourceVision Semantic Diff Failure UX Hardening

**Actionable UI diagnostics and retry guidance**
- Render semantic-diff failure diagnostics in PR Markdown UI banner and details panel
  Show structured failure data in the PR Markdown tab while continuing to display stale cached output, so users can diagnose issues without losing context.
  - UI displays a degraded-state banner when API reports semantic-diff failure
  - Details panel shows failing git subcommand and stderr excerpt from API response
  - Cached markdown remains visible and copyable while diagnostics are displayed
  - UI displays semantic-stage-specific remediation guidance distinct from name-status failures.
  - UI shows fallback state that explicitly indicates cached PR markdown was preserved.
  - End-to-end test validates API diagnostics are rendered with failing subcommand details and stage-appropriate remediation text.
- Classify retry guidance for fetch failures versus local history failures
  Differentiate remediation paths so users receive relevant retry instructions depending on whether failure stems from remote fetch/credentials or local branch/history state.
  - Failure classifier maps known fetch-related stderr patterns to fetch retry guidance
  - Failure classifier maps local-history stderr patterns to local remediation guidance
  - UI and API both expose the resolved guidance category and command suggestions for each classification path

**Diff-stage cache safety and API diagnostics**
- 🔶 **Guard cached PR markdown from semantic diff-stage invalidation**
  Prevent refresh from overwriting or clearing the last successful PR markdown artifact when failure occurs specifically during semantic diff inspection, preserving reviewer continuity.
  - When semantic diff inspection throws, cached PR markdown content remains unchanged on disk
  - Refresh response indicates degraded status and references the preserved cache timestamp
  - No empty or partial markdown artifact is written for failed diff-stage refresh attempts
- Return structured semantic-diff failure payload in refresh API
  Expose a stable API contract for diff failures so UI and automation can reliably parse error type, failing stage, command context, and remediation metadata.
  - Refresh API returns a typed error object with stage set to semantic-diff when diff inspection fails
  - Payload includes fields for failing git subcommand, stderr excerpt, and reproducible command list
  - Contract is covered by integration tests that validate field presence and schema for semantic-diff failures

- Diff-stage cache safety and API diagnostics *(feature)*
  Harden refresh behavior when semantic diff inspection fails so users keep prior output and receive machine-readable failure details.
- Actionable UI diagnostics and retry guidance *(feature)*
  Improve operator recovery by surfacing exact failure context and tailored next actions based on failure category.

### Timer Performance Optimization and Re-render Reduction

**Centralized Timer Management**
- Implement shared timer service for elapsed time updates
  Create a centralized timer service that manages a single setInterval and distributes tick events to subscribed components, eliminating the need for individual timers per task card
  - Single setInterval runs at 1-second intervals regardless of number of subscribers
  - Components can subscribe/unsubscribe from timer events
  - Timer service automatically starts when first subscriber joins and stops when last subscriber leaves
  - Memory leaks prevented through proper cleanup of event listeners
- Refactor task-audit.ts to use shared timer service
  Replace individual setInterval calls in task-audit.ts with subscriptions to the shared timer service, reducing timer overhead for multiple visible task cards
  - All individual setInterval calls removed from task-audit.ts
  - Elapsed time updates continue to work correctly
  - Component properly subscribes on mount and unsubscribes on unmount
  - No performance regression in elapsed time accuracy
- Refactor active-tasks-panel.ts to use shared timer service
  Replace individual setInterval calls in active-tasks-panel.ts with subscriptions to the shared timer service, reducing timer overhead for the active tasks display
  - All individual setInterval calls removed from active-tasks-panel.ts
  - Active task elapsed time updates continue to work correctly
  - Component properly subscribes on mount and unsubscribes on unmount
  - No performance regression in elapsed time accuracy

**Re-render Optimization**
- Implement batched state updates for elapsed time displays
  Group multiple elapsed time state updates into batched operations to reduce the frequency of component re-renders when many task cards are visible simultaneously
  - State updates for elapsed time are batched within the same tick cycle
  - Re-render frequency reduced compared to individual setState calls
  - UI remains responsive with smooth elapsed time updates
  - Performance improvement measurable with 20+ visible task cards
- Add memoization for elapsed time calculations
  Implement React.memo or useMemo to prevent unnecessary re-renders of elapsed time components when only the time value changes but other props remain constant
  - Elapsed time components only re-render when elapsed time actually changes
  - Components with identical props skip re-render cycles
  - Memory usage for memoization remains acceptable
  - Elapsed time display accuracy maintained
- Implement timer pause mechanism for inactive tabs
  Pause elapsed time timer updates when the browser tab becomes inactive to reduce unnecessary computation and battery usage
  - Timer pauses when document.visibilityState becomes 'hidden'
  - Timer resumes when document.visibilityState becomes 'visible'
  - Elapsed time catches up correctly when tab becomes active again
  - Page Visibility API properly handles all browser tab states

- Centralized Timer Management *(feature)*
  Replace individual per-component timers with a shared timer service to reduce CPU overhead and coordinate updates
- Re-render Optimization *(feature)*
  Minimize component re-renders caused by frequent timer updates through batching and memoization strategies

### Token Event Attribution Accuracy

**Event-metadata-driven utilization aggregation**
- 🔶 **Refactor utilization aggregation to group by event vendor/model**
  Change aggregation queries and reducers to use vendor/model stored on each event as the grouping key so historical and mixed-model usage is reported correctly.
  - Utilization totals are grouped by vendor+model from event records, not from current config
  - Changing project config after events are recorded does not alter historical utilization group assignment
  - Aggregated totals equal the sum of raw event token counts for each vendor/model group
- Implement fallback bucketing for incomplete event metadata
  Prevent data loss by routing events with missing attribution into explicit fallback buckets that remain visible in utilization outputs.
  - Events missing vendor and/or model are included in utilization under deterministic fallback labels
  - Fallback-labeled totals are surfaced in the same API/UI responses as normal vendor/model groups
  - No token events are dropped from totals due to missing metadata fields
- Add cross-package regression tests for attribution and grouping
  Create tests that simulate Rex, Hench, and SourceVision events with mixed vendors/models to verify end-to-end attribution and aggregation behavior.
  - Test fixtures include events from all three packages with at least two distinct vendor/model pairs
  - Assertions verify aggregation groups match event metadata and not current configured model
  - Assertions verify fallback bucket behavior for events with missing metadata
  - All new tests pass in CI test suites covering usage aggregation

**Per-event vendor/model metadata capture**
- 🔶 **Persist vendor/model on Rex token usage events**
  Update Rex usage event emission to attach vendor and model from the active request context so each event is self-describing and survives config changes.
  - Each newly written Rex token event includes non-empty vendor and model fields when provider metadata is available
  - If provider metadata is unavailable, Rex writes explicit fallback values (for example "unknown") instead of omitting fields
  - Existing Rex event schema validation passes with the new metadata fields present
- 🔶 **Persist vendor/model on Hench token usage events**
  Capture vendor/model at the moment Hench records run and task token usage so mixed-provider runs are attributed correctly per event.
  - New Hench token events include vendor and model fields derived from actual run execution metadata
  - Events produced by retries or multi-step runs preserve the vendor/model used for each individual event
  - Hench run summary generation continues to work without schema errors after metadata addition
- Persist vendor/model on SourceVision token usage events
  Add vendor/model attribution to SourceVision analysis token events so analysis usage is grouped by actual model invocation details.
  - SourceVision token events written during analyze flows include vendor and model fields
  - When model resolution falls back, SourceVision records the resolved fallback model in the event metadata
  - SourceVision token event parsing and display paths handle the new metadata without regression

- Per-event vendor/model metadata capture *(feature)*
  Ensure every token usage event records the actual LLM vendor and model used at execution time so later reporting is based on facts, not mutable config.
- Event-metadata-driven utilization aggregation *(feature)*
  Rework utilization calculations to aggregate by per-event vendor/model metadata rather than current configured model values.

### Token Usage Aggregation Performance Optimization

**Incremental Aggregation System**
- Implement incremental token usage updates instead of full rebuilds
  Replace the current full aggregation rebuild in aggregateTaskUsage() with an incremental system that only processes new or changed run files since the last aggregation
  - aggregateTaskUsage() only processes new/modified run files on subsequent calls
  - Initial aggregation still processes all existing run files
  - Aggregation time remains constant regardless of total run history size
  - Token usage totals remain accurate after incremental updates
- Add run file change detection and delta processing
  Implement file system monitoring or timestamp-based detection to identify which run files need processing, enabling efficient delta aggregation
  - System detects new run files added since last aggregation
  - System detects modified run files and re-processes them
  - Delta processing handles file deletions gracefully
  - Change detection works reliably across process restarts
- Implement aggregation result caching with invalidation
  Cache computed aggregation results to avoid redundant processing, with smart invalidation when underlying run data changes
  - Aggregation results are cached between polling intervals
  - Cache is invalidated when new run files are detected
  - Cache keys properly differentiate between different task scopes
  - Memory usage of cache is bounded and doesn't grow indefinitely

**Run History Management**
- Add run file archival and compression for old entries
  Implement automatic archival system that compresses or consolidates old run files to reduce file system overhead while preserving historical data
  - Run files older than configurable threshold are compressed
  - Compressed files maintain all necessary token usage metadata
  - Aggregation system can read both compressed and uncompressed files
  - Disk space usage grows more slowly with large run histories
- Implement run history retention policies
  Add configurable retention policies to automatically remove very old run files while preserving aggregated usage statistics
  - Retention policy is configurable (default 6 months)
  - Usage statistics are preserved even after individual runs are deleted
  - Policy enforcement runs automatically on schedule
  - Users receive warnings before data deletion occurs

**Stale Data Cleanup**
- Remove deleted task entries from usage aggregation state
  Clean up token usage entries for tasks that have been deleted from the PRD, preventing accumulation of stale data in the aggregation results
  - Deleted task usage entries are removed from aggregation state
  - Cleanup happens automatically during aggregation cycles
  - UI no longer displays usage data for non-existent tasks
  - Memory usage decreases when tasks are deleted
- Implement periodic cleanup of orphaned usage records
  Add scheduled cleanup process to remove usage records that no longer correspond to any PRD items, maintaining data consistency over time
  - Orphaned usage records are identified by cross-referencing with current PRD state
  - Cleanup runs on a configurable schedule (default weekly)
  - Cleanup process logs removed entries for auditability
  - Critical usage data is preserved through PRD restructuring

- Incremental Aggregation System *(feature)*
  Replace full aggregation rebuilds with efficient incremental updates to handle large run histories
- Stale Data Cleanup *(feature)*
  Remove obsolete entries from usage aggregation to prevent memory bloat and improve accuracy
- Run History Management *(feature)*
  Implement efficient storage and retention policies for historical run data to control growth

### TreeNodes DOM Performance Optimization

**Event Listener Optimization**
- Implement event delegation for tree node interactions
  Replace individual event listeners on each tree node with delegated event handling on the tree container to reduce listener count
  - Single delegated event listener handles all tree node clicks
  - Event delegation correctly identifies target tree nodes
  - All existing tree interactions work identically
  - Dramatic reduction in total event listener count
- Add event listener lifecycle management
  Implement proper cleanup and management of event listeners during node creation and destruction cycles
  - Event listeners removed when nodes are destroyed
  - No memory leaks from orphaned event listeners
  - Event listener count remains proportional to visible nodes
  - Memory profiling shows stable listener count during scrolling

**Lazy Rendering and Node Culling**
- Implement lazy rendering for collapsed tree branches
  Defer DOM creation for child nodes under collapsed parents until the parent is expanded by the user
  - Child nodes under collapsed parents are not rendered to DOM
  - Child nodes render on-demand when parent is expanded
  - State is preserved correctly across expand/collapse cycles
  - No visual flickering during expand/collapse operations
- Add off-screen node culling with cleanup
  Remove DOM nodes that scroll out of viewport and clean up associated event listeners to prevent memory bloat
  - DOM nodes removed when scrolled out of viewport buffer
  - Event listeners cleaned up when nodes are culled
  - Nodes re-created correctly when scrolled back into view
  - Memory usage remains stable during extended scrolling
- Implement progressive tree loading for large datasets
  Load and render tree nodes in chunks rather than all at once for very large PRD trees
  - Tree loads in configurable chunks (e.g., 50 nodes at a time)
  - Loading indicator shown while chunks are being processed
  - User can trigger loading of additional chunks on demand
  - Search and filter operations work across all loaded chunks

**Performance Monitoring and Metrics**
- Implement DOM performance monitoring dashboard
  Add performance metrics tracking for DOM node count, render time, and memory usage in tree components
  - Tracks active DOM node count in tree components
  - Measures tree render and update performance
  - Shows memory usage metrics for tree operations
  - Provides before/after comparison data
- Add large tree performance benchmarks
  Create automated benchmarks to validate performance improvements on trees with 500, 1000, and 2000+ items
  - Benchmark suite tests trees of various sizes
  - Measures DOM node count, render time, and memory usage
  - Validates performance targets are met
  - Includes regression testing for performance degradation

- Virtual Scrolling and Windowing Implementation *(feature)*
  Implement viewport-based rendering to only create DOM nodes for visible tree items
- Lazy Rendering and Node Culling *(feature)*
  Implement lazy rendering strategies to defer DOM creation until nodes are actually needed
- Event Listener Optimization *(feature)*
  Optimize event listener management to handle large trees efficiently without creating thousands of individual listeners
- Performance Monitoring and Metrics *(feature)*
  Add performance monitoring and metrics to track DOM performance improvements and identify bottlenecks

### Web UI Memory Management and Crash Resolution

**Crash Recovery and User Experience**
- Implement graceful degradation when approaching memory limits
  Add mechanisms to reduce functionality or disable resource-intensive features when memory usage approaches critical thresholds
  - Memory threshold detection triggers graceful degradation
  - Non-essential features disabled automatically under memory pressure
  - User informed of reduced functionality with clear explanations
  - Core functionality remains available during degraded mode
- Add crash detection and automatic recovery workflow
  Implement client-side crash detection and automatic page recovery with state preservation to improve user experience during memory-related crashes
  - Crash detection mechanism identifies memory-related failures
  - Automatic page reload triggered after crash detection
  - User navigation state preserved and restored after recovery
  - Clear user messaging explains what happened and recovery actions
- Implement memory-aware refresh throttling and queuing
  Add intelligent refresh scheduling that considers current memory usage and queues or delays refresh operations when memory pressure is high
  - Refresh operations queued when memory usage exceeds safe thresholds
  - Automatic refresh intervals adjusted based on memory availability
  - Manual refresh requests show memory status and estimated completion time
  - Refresh queue management prevents memory exhaustion during bulk operations

**Memory Optimization and Leak Prevention**
- 🔶 **Fix memory leaks in refresh orchestration and component lifecycle**
  Identify and resolve memory leaks in React components, event listeners, timers, and refresh orchestration that prevent proper garbage collection
  - Event listeners properly cleaned up on component unmount
  - Timer and interval references cleared appropriately
  - Refresh operations release memory after completion
  - Component memory usage returns to baseline after operations
- Implement memory-efficient data loading strategies for large datasets
  Replace bulk data loading with pagination, lazy loading, or streaming approaches for dashboard components that handle large amounts of data
  - Large dataset loading operations use pagination or chunking
  - Memory usage during data loading stays within acceptable thresholds
  - UI responsiveness maintained during data loading operations
- Implement memory usage monitoring and early warning system
  Add client-side memory monitoring to detect approaching memory limits and provide early warnings before crashes occur
  - Memory usage tracked and reported in real-time
  - Warning thresholds configured based on browser capabilities
  - Graceful degradation triggered before memory exhaustion
  - Memory usage data available for debugging and optimization

**OOM Crash Investigation and Root Cause Analysis**
- 🔶 **Profile memory usage patterns during web UI load and refresh cycles**
  Use browser dev tools and memory profiling to identify memory allocation patterns, leaks, and peak usage during initial load and subsequent refresh operations
  - Memory usage baseline established for normal UI operations
  - Memory spikes during refresh operations identified and quantified
  - Specific components or operations causing excessive memory allocation documented
- Investigate browser error code 5 triggers and recovery scenarios
  Research Chrome/browser error code 5 specifics and analyze crash dump data to understand the exact failure conditions and memory thresholds
  - Error code 5 trigger conditions documented
  - Memory thresholds that cause crashes identified
  - Browser-specific behavior differences catalogued

- OOM Crash Investigation and Root Cause Analysis *(feature)*
  Investigate and diagnose the recurring out-of-memory crashes that cause 'aw snap error code 5' in the web UI
- Memory Optimization and Leak Prevention *(feature)*
  Implement fixes to prevent memory leaks and reduce memory usage in web UI operations
- Crash Recovery and User Experience *(feature)*
  Implement crash detection, recovery mechanisms, and improved user experience during memory-related issues

### WebSocket Connection Lifecycle Management

**Dead Connection Detection and Cleanup**
- Implement immediate WebSocket disconnect detection
  Replace the 30-second ping/pong cycle with immediate connection state monitoring to detect client disconnections as soon as they occur
  - WebSocket disconnect events are detected within 1 second of occurrence
  - Dead connections are identified before the next broadcast attempt
  - Connection state monitoring has minimal performance overhead
- Remove dead clients from broadcast set immediately
  Automatically prune disconnected clients from the active broadcast list to prevent wasted serialization and write operations
  - Dead clients are removed from broadcast set within 1 second of disconnect detection
  - Broadcast operations skip dead clients entirely
  - Memory usage decreases immediately when clients disconnect
- Optimize broadcast operations for active connections only
  Ensure JSON serialization and socket write operations only target verified active connections to eliminate wasted CPU cycles
  - JSON.stringify is only called for confirmed active connections
  - Socket write attempts are eliminated for dead connections
  - Broadcast performance scales with active connection count, not total connection history
- Add WebSocket connection health monitoring dashboard
  Create visibility into WebSocket connection health, cleanup metrics, and resource usage to monitor the effectiveness of dead connection removal
  - Dashboard shows active vs total connection counts in real-time
  - Cleanup success rate and timing metrics are displayed
  - Resource usage trends are visible before and after cleanup improvements

- Dead Connection Detection and Cleanup *(feature)*
  Implement immediate detection and removal of disconnected WebSocket clients to prevent resource waste

### WebSocket Message Performance Optimization

**Message Throttling and Coalescing**
- Implement throttled WebSocket message handler with configurable debounce
  Replace direct message handlers with throttled versions that can handle rapid message sequences without triggering excessive API calls
  - WebSocket messages are debounced with configurable delay (default 250ms)
  - Throttling applies to rex:prd-changed, rex:item-updated, and rex:item-deleted messages
  - Configuration allows per-message-type throttle intervals
  - Memory footprint remains stable during message bursts
- Implement message coalescing for rapid sequential updates
  Batch multiple WebSocket messages that arrive in quick succession to reduce redundant fetchPRDData and fetchTaskUsage calls
  - Sequential messages of same type are coalesced within throttle window
  - Mixed message types are batched appropriately without data loss
  - Coalescing preserves message ordering semantics
  - Batch size limits prevent unbounded memory growth
- Add rate limiting for fetchPRDData and fetchTaskUsage calls
  Implement call-level rate limiting to prevent these expensive operations from being invoked more frequently than necessary
  - fetchPRDData calls are rate-limited to maximum 2 per second
  - fetchTaskUsage calls are rate-limited to maximum 2 per second
  - Rate limits are configurable via application settings
  - Queued calls are deduplicated to prevent redundant requests

**UI Update Optimization**
- Implement intelligent tree re-render optimization
  Replace full tree re-renders with targeted updates that only modify changed nodes, reducing CPU load and improving UI responsiveness
  - Tree updates use virtual DOM diffing to minimize DOM manipulation
  - Only changed nodes and their ancestors are re-rendered
  - Re-render performance scales sub-linearly with tree size
  - UI remains responsive during rapid update sequences

- Message Throttling and Coalescing *(feature)*
  Implement intelligent throttling and batching mechanisms to handle high-frequency WebSocket messages without overwhelming the UI
- UI Update Optimization *(feature)*
  Optimize rendering pipeline to minimize unnecessary DOM updates and improve responsiveness during high-frequency data changes

### (Ungrouped)

- 🔶 **Codex Vendor Reliability and Documentation** *(epic)*
- 🔶 **Selective Recommendation Acceptance Syntax** *(epic)*
- 🔶 **Init-time LLM Onboarding and Authentication** *(epic)*
- 🔶 **Live PR Markdown in SourceVision UI** *(epic)*
- 🔶 **SourceVision PR Markdown Tab Parity Hardening** *(epic)*
- 🔶 **SourceVision PR Markdown Quality & Manual Refresh** *(epic)*
- 🔶 **Rex Token Usage & LLM Utilization UX Overhaul** *(epic)*
- 🔶 **ndx Dashboard Refresh Orchestration** *(epic)*
- 🔶 **Token Event Attribution Accuracy** *(epic)*
- 🔶 **Deterministic Task Utilization Budget Fallback** *(epic)*
- 🔶 **Dashboard Navigation Information Architecture** *(epic)*
- 🔶 **Duplicate-aware Proposal Override for rex add** *(epic)*
- 🔶 **Dashboard Route Ownership Decoupling** *(epic)*
- 🔶 **PR Markdown Reviewer Context Enrichment** *(epic)*
- 🔶 **SourceVision PR Markdown Refresh Degraded-Mode Hardening** *(epic)*
- 🔶 **SourceVision PR Markdown Git Preflight and Credential Diagnostics** *(epic)*
- 🔶 **SourceVision Semantic Diff Failure UX Hardening** *(epic)*
- 🔶 **SourceVision PR Markdown Artifact-Based Fallback Mode** *(epic)*
- 🔶 **Git Credential Helper Opt-In Recovery** *(epic)*
- 🔶 **SourceVision Semantic Diff Determinism and Tooling-Drift Hardening** *(epic)*
- 🔶 **Git-Independent PR Markdown Generation** *(epic)*
- 🔶 **PR Markdown View Toggle and Copy UX** *(epic)*
- 🔶 **Process Lifecycle Management and Graceful Shutdown** *(epic)*
- 🔶 **LLM Client Circular Dependency Resolution** *(epic)*
- 🔶 **Rex Task and Epic Deletion Functionality** *(epic)*
- 🔶 **PR Build Pipeline and Code Quality Automation** *(epic)*
- 🔶 **Web UI Memory Management and Crash Resolution** *(epic)*
- 🔶 **Interactive PRD Validation and Consistency Resolution** *(epic)*
- 🔶 **Branch Work System of Record** *(epic)*
- 🔶 **Automatic PR Markdown Generation** *(epic)*
- 🔶 **Enhanced Rex Recommend Selective PRD Creation** *(epic)*
- 🔶 **Memory-Aware Polling Loop Management** *(epic)*
- 🔶 **WebSocket Message Performance Optimization** *(epic)*
- 🔶 **TreeNodes DOM Performance Optimization** *(epic)*
- 🔶 **Timer Performance Optimization and Re-render Reduction** *(epic)*
- 🔶 **API Request Deduplication and Coordination** *(epic)*
- 🔶 **Token Usage Aggregation Performance Optimization** *(epic)*
- 🔶 **Background Tab Resource Optimization** *(epic)*
- 🔶 **Hench Process Concurrency Management** *(epic)*
- 🔶 **Hench Resource Monitoring and User Feedback** *(epic)*
- 🔶 **WebSocket Connection Lifecycle Management** *(epic)*
- 🔶 **Rex Web UI Search Interface** *(epic)*

