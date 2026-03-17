# Architectural Enforcement Map

Which rules are enforced, where, and how. Prevents duplicate or conflicting enforcement.

## Enforcement Mechanisms

| Constraint | Enforcement File | Mechanism | Failure Mode |
|-----------|-----------------|-----------|--------------|
| Cross-package gateway imports | `ci.js` (step 3b) + `tests/e2e/domain-isolation.test.js` | Scans for runtime imports outside gateway files | CI failure |
| Domain isolation (rex ↔ sourcevision) | `tests/e2e/domain-isolation.test.js` | Verifies domain packages have no cross-imports | Test failure |
| Orchestration tier boundary (spawn-only) | `tests/e2e/domain-isolation.test.js` | Checks orchestration files have no runtime library imports | Test failure |
| Direct `node:child_process` imports | `tests/e2e/architecture-policy.test.js` | Allowlist-based scan of all packages | Test failure |
| Intra-package layering (domain → CLI) | `tests/e2e/architecture-policy.test.js` | Ensures `src/core/` never imports from `src/cli/` | Test failure |
| Gateway contract (hench → rex) | `packages/hench/tests/unit/prd/rex-gateway.test.ts` | EXPECTED_EXPORTS list vs actual re-exports | Test failure |
| Gateway contract (web → sourcevision) | `packages/web/tests/unit/server/domain-gateway.test.ts` | Verifies re-export matches canonical export | Test failure |
| Type reference identity (web → rex) | `packages/web/tests/unit/server/type-consistency.test.ts` | `toBe()` identity check on re-exported constants | Test failure |
| Zone ID consistency | `ci.js` (step 3a) | Zone IDs in `zones.json` match directory names | CI failure |
| Zone health thresholds | `ci.js` | Cohesion ≥ 0.5, coupling ≤ 0.25 for non-asset zones | CI warning |
| Zone size distribution | `packages/sourcevision/tests/unit/analyzers/zone-size-policy.test.ts` | Max 30% zone size | Test failure |
| Hench guard policy limits | `packages/hench/tests/unit/guard/policy.test.ts` | Rate limits, session limits, audit trail | Test failure |
| Server/viewer boundary | `ci.js` (boundary rules) | `server/` cannot import `../viewer/` | CI failure |
| Community files | `ci.js` | Requires `CODE_OF_CONDUCT.md` | CI failure |

## Configuration

Gateway and boundary rules are defined in a single source of truth:

- **`gateway-rules.json`** — consumed by both `ci.js` and `domain-isolation.test.js`

## Adding New Rules

1. Check this table first — the constraint may already be enforced.
2. Choose the right mechanism:
   - **Type system** (`tsc`): for API shape contracts — zero runtime cost.
   - **Unit/integration test**: for fast, focused contract assertions (gateway contracts, policy limits).
   - **E2E test**: for cross-package boundary enforcement requiring import graph analysis.
   - **CI pipeline** (`ci.js`): for rules that need sourcevision analysis output.
3. Add the rule to this table with file path and failure mode.
