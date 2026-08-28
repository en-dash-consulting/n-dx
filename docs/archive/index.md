# Archive

Point-in-time documents kept for historical context. **Every page here describes
the state of the project on the date it was written and has not been maintained
since** — model IDs, zone metrics, file counts, and test results in these pages
are frequently out of date.

They are retained because they record *why* a decision was made, which the
current docs deliberately omit. Do not treat any of them as a description of how
n-dx works today; for that, start at the [documentation index](/).

## Discovery and design records

| Page | Written | Records |
|------|---------|---------|
| [Claude/Codex Runtime Identity](/archive/claude-codex-runtime-identity-discovery) | 2026-03-31 | Why the vendor runtime contract exists |
| [Codex Transport Decisions](/archive/codex-transport-artifact-decisions) | 2026-03-31 | Why init registers stdio MCP, not HTTP |
| [Phase 1 Audit / Phase 2 Risk](/archive/phase1-audit-phase2-risk-assessment) | 2026-04-01 | Codex integration risk assessment |
| [Phase 2 Vendor Normalization](/archive/phase2-vendor-normalization) | 2026-04-01 | Vendor-normalized hench execution plan |
| [Deferred Runtime Parity](/archive/deferred-runtime-parity) | 2026-04-02 | What the Codex parity epic deliberately did not do |
| [Init LLM Provider Selection](/archive/init-llm-provider-model-selection) | 2026-04-02 | Design of the guided init flow. **Model lists here are historical** — see [Configuration](/guide/configuration) for current models. |

## Audits and profiling

| Page | Written | Records |
|------|---------|---------|
| [CLI Hint Audit](/archive/cli-hint-audit) | 2026-04-13 | Sweep of CLI hint text |
| [Documentation Delta Audit](/archive/doc-delta-audit) | 2026-04-22 | Seven-day docs-vs-code delta |
| [Config Schema → UI Gap](/archive/config-schema-ui-gap) | 2026-04-18 | Config fields missing dashboard controls |
| [PRD Tree Write Baseline](/archive/prd-tree-write-baseline) | 2026-05-01 | Folder-tree write profiling |
| [Shared Unit Test Baseline](/archive/shared-unit-test-consolidation-baseline) | 2026-04-06 | Pre-refactor coverage inventory |
| [Shared Unit Test Helpers](/archive/shared-unit-test-helper-inventory) | 2026-04-06 | Duplicated helper inventory |

## Environment-specific findings

| Page | Written | Records |
|------|---------|---------|
| [E2E Timeout Findings](/archive/e2e-timeout-findings-cli-init-ci) | — | Vitest parallelism vs the 5s default timeout |
| [Windows Integration Discovery](/archive/windows-integration-discovery) | — | Windows gaps inferred from macOS; never validated natively |
| [Current Failure Groups](/archive/current-failure-groups) | 2026-04-06 | Red suites grouped by root cause, in one sandbox |

For the maintained equivalents see [CLI ↔ Dashboard Coverage](/cli-ui-gap)
(actively updated), [Testing Conventions](/contributing/testing), and
[Configuration](/guide/configuration).
