---
"@n-dx/web": patch
---

Fix an import-graph history bug and make the web test suite deterministic under parallel load.

Dependency-preview **Back** could be permanently disabled: clicking a file before the focus-history seeding effect flushed (slow first paint) dropped the outgoing file, so history held a single entry. Seeding now happens synchronously with the click.

Test-side: route tests bind and fetch `127.0.0.1` (never `localhost`), await server close so ephemeral ports are fully released, and reset process-wide route state via `resetHenchRouteStateForTests()`. The DOM-counting complexity test counts traversal steps instead of comparing elapsed-time ratios, and gesture-driven graph tests re-dispatch inside `waitFor` rather than firing once at a listener that may not be attached. Rules for both failure families are documented in TESTING.md.

The web package typecheck now also covers `packages/web/tests`, so test-only type and syntax errors fail `pnpm typecheck` instead of surfacing later during Vitest transforms.
