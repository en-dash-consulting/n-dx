## Web package internal zone layering

The web package decomposes into a hub topology with `web-viewer` at the centre:

```
  web-server          (composition root — Express routes, gateways, MCP handlers)
       ↓                    ↓ (serves static assets only, no runtime import)
  web-viewer          (Preact UI hub — components, hooks, views)
       ↑ ↓                  ↓
  viewer-message-pipeline  (messaging middleware — coalescer, throttle, rate-limiter, request-dedup)
       ↓                    ↓
  src/shared/         (framework-agnostic utilities — data-files, features, view-id, view-routing)
```

`web-viewer` is the hub: it imports from `viewer-message-pipeline` (through
`external.ts`) and `src/shared/`, and receives imports from sub-zones like
`crash/`. `web-server` is a parallel composition root — it wires gateways and
routes but never imports `web-viewer` at runtime, because the viewer is built
separately and served as static assets. `src/shared/` is the foundation, with
zero upward dependencies. `boundary-check.test.ts` enforces all of it. Read live
zone metrics with `ndx analyze --deep .` rather than a number written down here;
no web zone currently meets the dual-fragility threshold.

**The sections below are directory policies, not zone policies.** Louvain does
not currently emit standalone `web-shared`, `crash` or `viewer-ui-hub` zones, but
the directories exist and the tests enforce the rules, so they stay in force. The
root `AGENTS.md` has the threshold definition and the universal rules.

**Guidance for a directory sits beside it.** `src/server/AGENTS.md` holds the
request gate, workspace-scoped writes, the PRD lock and the injection seams;
`src/hub/AGENTS.md` the hub daemon; `src/viewer/AGENTS.md` the gateway boundary
and UI composition. Every assistant reads a nested `AGENTS.md`, so that is where
a rule about those directories belongs — not here, and not in `.claude/rules/`.
Reasoning behind the server rules:
[docs/architecture/web-server.md](../../docs/architecture/web-server.md).

## `src/shared/` is the foundation

Its addition policy — framework-agnostic only, barrel imports, the
two-consumer rule — and the `item-type.ts` invariant that makes it the only
reader of v1's `level` are in `src/shared/AGENTS.md`, beside the code.
All three are asserted by `boundary-check.test.ts`.

## `crash/` proactive governance

`crash/` (`crash-detector.ts` + `index.ts`) is imported unidirectionally by
`web-viewer` and reaches into `src/shared/` directly — a documented bypass.
Imports must enter through `crash/index.ts`, asserted by
`boundary-check.test.ts`. Apply the two-consumer rule proactively to additions.

## Feature-toggle enforcement

Toggles in `routes-features.ts`'s registry are enforced in the viewer by
`useFeatureToggle`, and **every entry point into a gated surface must read the
same toggle**. The Explain button on Problems and Suggestions is the worked
example: it is not a stage section, so gating the stage pages alone left a
default-off feature reachable through a side door. Views that cannot call the
hook take the value as a prop from `main.ts` via `ViewRenderContext`, defaulting
to `false`.

**Server-side enforcement is per-toggle, not universal.** Use
`isFeatureEnabled(projectDir, key)` when a route must not act with its feature
off; it reads `.n-dx.json` per call and fails closed. `sourcevision.ask` and
`rex.placementDraft` are gated that way, because each call spends tokens — `sourcevision.prMarkdown`
renders from analysis already on disk, so a direct request costs nothing. Decide
a new toggle on that basis, not by copying its nearest neighbour.

## Web viewer gateway boundary

The rule lives in `src/viewer/AGENTS.md`, beside the code it governs:
`external.ts` concentrates viewer-side imports from `messaging/`, `shared/` and
`schema/`, with a type-import exemption and a messaging exemption, both enforced
by `boundary-check.test.ts`.

## Web injection seam registry

The table lives in `src/server/AGENTS.md`, beside the code it governs. Three
seams in `start.ts` inject callbacks rather than importing — the scheduler
(`RegisterSchedulerOptions`), the workspace registry (`WorkspaceHooks`) and the
Live routes (`LiveSources`). Static analysis cannot see them, so a new one needs
a row there and a named interface type in the target module.

A package other than web or core that grows an injection seam puts its registry
in that package's own `AGENTS.md`, with its `CLAUDE.md` reduced to the
`@AGENTS.md` import — `packages/llm-client/` is the reference pair. Do not add a
new `.claude/rules/` registry: that directory is read by Claude Code and nothing
else, so a registry parked there is invisible to every other assistant.
