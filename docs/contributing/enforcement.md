# Enforcement Map

Which architectural rules are enforced, where, and how. Check this table before adding new rules.

## Enforcement Mechanisms

| Constraint | Enforcement File | Mechanism | Failure Mode |
|-----------|-----------------|-----------|--------------|
| Cross-package gateway imports | `ci.js` + `domain-isolation.test.js` | Scans for runtime imports outside gateway files | CI failure |
| Domain isolation (rex <-> sourcevision) | `domain-isolation.test.js` | Verifies no cross-imports between domain packages | Test failure |
| Orchestration tier boundary (spawn-only) | `domain-isolation.test.js` | Checks orchestration files have no runtime library imports | Test failure |
| Direct `node:child_process` imports | `architecture-policy.test.js` | Allowlist-based scan of all packages | Test failure |
| Intra-package layering (domain -> CLI) | `architecture-policy.test.js` | Ensures `src/core/` never imports from `src/cli/` | Test failure |
| Gateway contract (hench -> rex) | `rex-gateway.test.ts` | EXPECTED_EXPORTS list vs actual re-exports | Test failure |
| Gateway contract (web -> sourcevision) | `domain-gateway.test.ts` | Verifies re-export matches canonical export | Test failure |
| Type reference identity (web -> rex) | `type-consistency.test.ts` | `toBe()` identity check on re-exported constants | Test failure |
| Zone health thresholds | `ci.js` | Cohesion >= 0.5, coupling <= 0.25 for non-asset zones | CI warning |
| Hench guard policy limits | `policy.test.ts` | Rate limits, session limits, audit trail | Test failure |
| Server/viewer boundary | `ci.js` | `server/` cannot import `../viewer/` | CI failure |
| Required test annotations | `architecture-policy.test.js` | `REQUIRED TEST` annotation must exist in required test files | Test failure |
| Integration test growth | `integration-coverage-policy.test.js` | Integration files >= 15% of e2e count | Test failure |

## Configuration

Gateway and boundary rules are defined in `gateway-rules.json`, consumed by both `ci.js` and `domain-isolation.test.js`.

## Adding New Rules

1. Check this table first — the constraint may already be enforced
2. Choose the right mechanism:
   - **Type system** (`tsc`): for API shape contracts
   - **Unit/integration test**: for fast, focused contract assertions
   - **E2E test**: for cross-package boundary enforcement
   - **CI pipeline** (`ci.js`): for rules needing sourcevision analysis output
3. Add the rule to this table
