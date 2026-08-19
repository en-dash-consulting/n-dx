---
paths:
  - "packages/web/src/server/**"
---

# Web injection seam registry

Some cross-zone dependencies inside the web package use callback injection rather than
gateway imports. These seams are invisible to static analysis tools
(`boundary-check.test.ts`, `domain-isolation.test.js`) and must be listed explicitly to
prevent future contributors from replacing injection with direct imports.

| Injection site | Target module | Injected callbacks | Interface type |
|----------------|---------------|---------------------|-----------------|
| `src/server/start.ts` | `src/server/task-usage.ts` (barrel facade — re-exports from `task-usage/register-scheduler.ts`; import through the facade, not the subdirectory file directly) | `broadcast`, `collectAllIds`, `loadPRD`, `getAggregator` | `RegisterSchedulerOptions` |

Rules:
- **Prefer injection over import** when the target module would otherwise need to import
  from a higher-tier zone (e.g., scheduler importing from dashboard wiring).
- **Document the interface type** — every injection seam must have a named TypeScript
  interface (not inline parameter types) so that refactoring either side triggers a type
  error.
- **New seams** require an entry in this table and a named interface type in the target
  module.

If a package other than web adds an injection seam, create an analogous
`.claude/rules/<package>-injection-seams.md` following this template — the pattern
itself (and the "why" above) is not web-specific, only today's single instance is.
