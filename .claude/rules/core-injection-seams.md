---
paths:
  - "packages/core/**"
---

# Core injection seam registry

Some cross-zone dependencies inside the core package use callback injection rather than
gateway imports. These seams are invisible to static analysis tools
(`boundary-check.test.ts`, `domain-isolation.test.js`) and must be listed explicitly to
prevent future contributors from replacing injection with direct imports.

| Injection site | Target module | Injected callbacks | Interface type |
|-----------------|---------------|---------------------|-----------------|
| `cli.js` | `pair-programming.js` | `registerChild` | `RegisterChild` (JSDoc `@callback`) |

Rules:
- **Prefer injection over import** when the target module would otherwise need to import
  from a higher-tier zone. `cli.js` → `pair-programming.js` is the other shape of the same
  problem: `cli.js` already imports `pair-programming.js`, so the tracker can only travel
  forwards as a callback.
- **Document the interface type** — every injection seam must have a named TypeScript
  interface (not inline parameter types) so that refactoring either side triggers a type
  error. In a plain-JS module a named JSDoc `@typedef`/`@callback` serves the same purpose
  and is still checked by `tsc`.
- **New seams** require an entry in this table and a named interface type in the target
  module.
- **A seam that defaults to a no-op silently opts callers out.** `registerChild` defaults
  to `doNotTrack`, so a caller that forgets it loses Ctrl-C cleanup without any error. That
  is a deliberate trade for keeping existing callers and tests working, but it means the
  default is the dangerous path — worth an explicit look when adding a caller.

If a package other than web or core adds an injection seam, create an analogous
`.claude/rules/<package>-injection-seams.md` following this template — the pattern itself
(and the "why" above) is not package-specific, only today's two instances are.
