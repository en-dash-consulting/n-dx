---
"@n-dx/web": patch
"sourcevision": patch
---

Pass-gated SourceVision views (Architecture P2, Problems P3, Suggestions P4) are now navigable before their data exists: the sidebar no longer disables locked tabs, and each locked view shows an unlock page with two actions — run enrichment up to just the pass that view needs, or run the full analysis (all passes). Backed by a new `sourcevision analyze --target-pass=<N>` flag and a `targetPass` option on `POST /api/commands/sv-analyze` (async with status polling, like full runs).
