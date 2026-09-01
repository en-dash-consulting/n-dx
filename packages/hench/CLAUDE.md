## hench zone internal governance

Louvain reports hench as a single `hench` zone: 108 TypeScript files under `src/`, cohesion 1.00 / coupling 0.00 as of the 2026-08-24 `ndx analyze --deep` run on `main`. That makes it the **third-largest** production zone, after `web-viewer` (205) and `rex-cli` (170). Earlier revisions of this file called it `hench-agent`, claimed "160+ files, 31 directories", and described it as the second-largest zone in the monorepo — none of which matches the current analysis.

Actual `src/` sub-directories:

| Directory | Role | Barrel `index.ts` |
|-----------|------|:-----------------:|
| `agent/` | Agent loop, lifecycle, tool dispatch, conversation management | ✅ |
| `cli/` | Command handlers, help, output | — |
| `guard/` | Policy limits, rate limiting, audit trail | — |
| `prd/` | PRD integration via `rex-gateway.ts` and `llm-gateway.ts` | ❌ |
| `process/` | Process lifecycle, concurrency management | ❌ |
| `queue/` | Work queueing | — |
| `quota/` | Token quota retrieval and formatting | — |
| `schema/` | Type definitions and validation | — |
| `store/` | Config and run-record persistence | — |
| `tools/` | Tool implementations (file ops, shell, search) | ❌ |
| `types/` | Shared type declarations | — |
| `validation/` | Input validation | — |

There is no `brief/` directory — task-brief construction lives in `agent/planning/`. Earlier revisions listed `brief/` as a sub-zone.

Rules:
- **Barrels are the target, not the current state.** Only `agent/` has an `index.ts`; `prd/`, `process/`, and `tools/` do not. Adding one is preferred when touching a sub-directory's public surface, but no test enforces it yet.
- Cross-sub-directory imports should flow through barrels where they exist, not reach into internal modules.
- Boundary assertions should be added to hench's test suite before the zone approaches `web-viewer`'s scale. Nothing enforces these boundaries today, so treat them as review guidance rather than guarantees.
