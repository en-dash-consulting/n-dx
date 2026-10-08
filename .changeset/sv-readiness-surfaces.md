---
"@n-dx/sourcevision": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

Surface SDLC readiness through the CLI, `ndx`, MCP and the dashboard status.

`analyze` now writes `readiness.json` beside `sdlc-profile.json` — the weighted
score computed from the detected profile. Four surfaces read it:

- `sourcevision readiness [--json]` prints the scorecard, with the evidence
  behind each dimension and the gap that would raise it.
- `ndx readiness` delegates to it, forwarding `--json`.
- `get_readiness` on the SourceVision MCP server returns the same artifact.
- `GET /api/status` carries `sv.readiness` (`{ overall, analyzedAt }`), null
  rather than absent on an analysis that produced no readiness artifact.

The CLI and MCP surfaces recompute from `sdlc-profile.json` rather than serving
`readiness.json`, so a weight change shows up without a re-analysis; the
persisted file is for readers that only want the headline. The scorecard is
heuristic — it detects whether a practice exists and is wired up, not whether it
is good — and is labelled as such on every surface that publishes it.
