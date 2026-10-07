## Core injection seam registry

> `.claude/rules/core-injection-seams.md` scopes this section to `packages/core/`
> for Claude Code; the text lives here so every assistant reads it.

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

A package other than core or web that grows an injection seam puts its registry in that
package's own `AGENTS.md`, with its `CLAUDE.md` reduced to the `@AGENTS.md` import —
`packages/llm-client/` is the reference pair. The pattern itself (and the "why" above) is
not package-specific; only today's instances are. Do not add a new `.claude/rules/`
registry: that directory is read by Claude Code and nothing else, so a registry parked
there is invisible to Codex and every other assistant.
