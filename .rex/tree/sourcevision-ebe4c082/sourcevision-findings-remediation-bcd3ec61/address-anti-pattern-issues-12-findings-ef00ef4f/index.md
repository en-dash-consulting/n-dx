---
id: "ef00ef4f-7bf8-41b5-a032-eeea176b88f1"
level: "task"
title: "Address anti-pattern issues (12 findings)"
status: "completed"
priority: "critical"
source: "sourcevision"
startedAt: "2026-03-08T04:22:52.355Z"
completedAt: "2026-03-08T04:33:10.892Z"
acceptanceCriteria: []
description: "- architecture-policy.test.js and check-gateway-*.mjs in monorepo-maintenance-scripts likely enforce overlapping gateway constraints via different mechanisms (test harness vs. raw script) — without explicit documentation of which rules live where, the two enforcement layers will drift when rules are updated.\n- cli-contract.test.mjs uses .mjs while all 18 peer files use .js — module format inconsistency in a vitest suite can cause silent resolution differences if the runner applies different transform pipelines to .mjs vs .js files; standardize to .js.\n- Hench and rex are independently buildable packages with no runtime version assertion. A mismatch between hench dist/ and installed rex version will produce a silent behavioral failure rather than a clear compatibility error at startup.\n- domain-gateway.ts has no dedicated test. As the sole web→sourcevision import seam, a silent re-export breakage (e.g. sourcevision renames createSourcevisionMcpServer) would only be caught when a route request reaches the MCP handler at runtime — not during build or test. A minimal gateway contract test (import the symbol, assert it is a function) would catch this at CI time.\n- Maintenance scripts use .mjs (untyped) while the entire source base is TypeScript — structural validation scripts that enforce TypeScript architectural rules are themselves exempt from TypeScript's type checking, creating an ironic enforcement gap where the enforcer cannot be enforced.\n- Root orchestration scripts (cli.js, web.js, ci.js) are plain JS in a TypeScript monorepo, making cross-package API breakage undetectable at typecheck time. Even a full pnpm typecheck pass will not catch broken orchestration contracts.\n- pending-proposals.json is written by rex analyze and read by rex recommend with no file-level locking. Concurrent CLI invocations (common in CI) can produce a torn read/write on this file.\n- prd.json lacks a schema version field, making it impossible for consumers (hench, web) to detect format incompatibility at load time. A silent schema mismatch between package versions will corrupt PRD state without a diagnostic error.\n- rex-gateway.ts re-exports 35+ symbols covering domain types, constants, tree utilities, analytics, health, and reshape operations — it mirrors the entire rex public API rather than defining a minimal web-specific interface. A true gateway should expose only what consumers need, providing a stable seam; a full-mirror gateway offers no stability guarantee and generates false confidence that coupling is controlled.\n- routes-rex.ts is a 1000+ line file that handles route dispatch, input validation, tree mutations, prune logic, merge orchestration, analysis triggering, and requirements CRUD — it has at least 6 distinct responsibilities. This makes it the highest-risk file in the monorepo: a change to any one concern (e.g. prune logic) requires reading and testing the entire file.\n- God function: cmdStatus in packages/rex/src/cli/commands/status.ts calls 36 unique functions — consider decomposing into smaller, focused functions\n- God function: <module> in scripts/hench-callgraph-analysis.mjs calls 33 unique functions — consider decomposing into smaller, focused functions"
recommendationMeta: "[object Object]"
---

## Subtask: Quick wins: rename .mjs test, add domain-gateway test, clean deprecated scripts

**ID:** `6ef02293-68b9-432a-877d-46de7703868f`
**Status:** completed
**Priority:** high

1. Rename cli-contract.test.mjs to .js for consistency with 18 peer test files
2. Add a minimal contract test for domain-gateway.ts (import symbol, assert function)
3. Clean up deprecated check-gateway-*.mjs stubs and empty test-zone-consistency.mjs
4. Document that prd.json already has schema version (finding 8 is resolved)
5. Document that gateway enforcement overlap (finding 1) is resolved (scripts deprecated)

---

## Subtask: Add file-level locking for pending-proposals.json

**ID:** `3458ab92-bb27-4172-a722-1fae2f3bc83d`
**Status:** completed
**Priority:** medium

pending-proposals.json is written by rex analyze and read by rex recommend with no file-level locking. Add atomic write (write to temp + rename) to prevent torn reads in concurrent CI.

---

## Subtask: Add runtime version compatibility check between hench and rex

**ID:** `b5f3c7aa-a5f2-4c19-a0a0-76e23f5c5d48`
**Status:** completed
**Priority:** medium

Hench imports rex at runtime via rex-gateway. Add a version compatibility assertion at startup so mismatched package versions produce a clear error instead of silent behavioral failures.

---

## Subtask: Decompose routes-rex.ts into focused route modules

**ID:** `cd2f263a-62bf-43d2-823c-7696d8148a65`
**Status:** completed
**Priority:** medium

routes-rex.ts is 3076 lines with 6+ responsibilities. Split into focused modules: tree-mutations, prune-logic, merge-orchestration, analysis, requirements-crud, input-validation.

---

## Subtask: Trim rex-gateway.ts to minimal web-specific interface

**ID:** `7bdc7756-692e-494e-8aac-d7f787c2f8d7`
**Status:** completed
**Priority:** medium

rex-gateway.ts re-exports 21+ symbols. Audit actual usage in web package routes and remove unused re-exports to create a minimal stable seam.

---

## Subtask: Decompose cmdStatus into focused rendering functions

**ID:** `365d6811-7d94-481c-91ca-d8e215f7ec58`
**Status:** completed
**Priority:** low

cmdStatus in status.ts is 518 lines calling 36 functions. Extract tree rendering, coverage formatting, budget warnings, and auto-complete suggestions into focused helpers.

---
