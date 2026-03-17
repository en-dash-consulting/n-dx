# Zone Naming Conventions

Rules for naming zones detected by sourcevision's Louvain community detection and enriched by AI.

## Zone ID format

- **kebab-case**: `web-dashboard-mcp-server`, `dom-performance-monitoring`
- **Title Case name**: `Web Dashboard & MCP Server`, `DOM Performance Monitoring`
- IDs are stable across analysis runs when zone membership is unchanged

## Source vs test zones

The `-tests` and `-test-suite` suffixes are **reserved for zones that contain only test files**.

| Suffix | Allowed content | Examples |
|--------|----------------|---------|
| `-tests` | Test files only | `packages-llm-client-llm-provider-tests` |
| `-test-suite` | Test files only | `cli-e2e-test-suite`, `packages-rex-cli-e2e-test-suite` |
| (no test suffix) | Production code, or production code + tests | `prd-tree-lifecycle`, `dom-performance-monitoring` |

### Rationale

Tooling and CI pipelines may use the `-tests` suffix to identify test-only zones for:
- Skipping in production build optimization
- Excluding from source coverage analysis
- Applying different quality thresholds

A zone containing production source files alongside tests must be named after its **production purpose**, not its test content.

### How this is enforced

The naming convention is embedded in sourcevision's AI enrichment prompt (pass 1 in `enrich-config.ts`). The LLM is instructed:

> The '-tests' suffix is reserved for zones that contain ONLY test files. If a zone contains any production source files alongside test files, name it after its production purpose.

### Current zone inventory by type

**Test-only zones** (correctly suffixed):
- `cli-e2e-test-suite` — root-level CLI end-to-end tests
- `packages-rex-cli-e2e-test-suite` — Rex CLI end-to-end tests
- `packages-llm-client-llm-provider-tests` — LLM client provider tests
- `packages-sourcevision-integration-validation-tests` — Sourcevision integration tests
- `packages-sourcevision-test-fixture-projects` — Test fixture data

**Mixed zones** (production + tests, correctly named without `-tests`):
- `prd-tree-lifecycle` — Lifecycle components + their unit tests
- `dom-performance-monitoring` — DOM perf monitor + tests
- `viewer-call-rate-limiter` — Rate limiter + tests

## Package-scoped zone IDs

Zones detected within individual packages are prefixed with the package path:
- `packages-rex-cli-e2e-test-suite` (from `packages/rex/`)
- `packages-sourcevision-analysis-pipeline` (from `packages/sourcevision/`)
- `packages-llm-client-llm-provider-core` (from `packages/llm-client/`)

Root-level zones (detected in the monorepo-wide analysis) have no prefix:
- `web-dashboard-mcp-server`
- `prd-tree-lifecycle`
- `landing-page`
