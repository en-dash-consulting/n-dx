---
"@n-dx/sourcevision": minor
"@n-dx/rex": minor
"@n-dx/web": patch
---

### SourceVision
- **Zone stability:** Louvain community detection now seeds from previous zone assignments, preserving topology across runs. Files stay in their previous zones unless import structure genuinely shifts.
- **Zone identity preservation:** Zones with >50% file overlap with a previous zone inherit its ID and name, preventing the LLM from inventing new names each run.
- **Stability bias:** Synthetic co-zone edges reinforce previous zone membership during Louvain optimization. Configurable weight (default 0.5x median import edge).
- **Stability reporting:** New `stability` field in zones.json tracks file retention, persisted/new/removed zones, and reassigned files between runs.
- **Finding category taxonomy:** Findings now carry a `category` field (`structural`, `code`, `documentation`) enabling downstream filtering. LLM prompts request categories; regex heuristic classifies when LLM doesn't provide one.
- **Finding staleness validation:** Findings referencing deleted/moved files are automatically skipped during `rex recommend`.
- **Weighted cohesion metrics:** Project-wide averages weighted by zone file count. Zones with <5 files excluded from aggregates (unreliable metrics). Both weighted and unweighted averages reported.
- **Small-zone merge logging:** Configurable merge threshold with debuggability logging.
- **Git SHA refresh:** `manifest.gitSha` now updated at analysis start, not just init time.

### Rex
- **Self-heal: exclude structural findings:** `--exclude-structural` flag on `rex recommend` skips zone boundary opinions. Self-heal loop passes it by default.
- **Self-heal: file-level regression guard:** Progress signals shifted from zone-relative (weighted cohesion) to zone-independent metrics (circular deps, code findings, unused exports).
- **Zone pin discoverability:** `ndx analyze` suggests zone pins when structural findings detected. `ndx config --help` documents `sourcevision.zones.pins`. `rex recommend` shows pin tip for structural findings.
- **Workflow split:** Base n-dx workflow in `n-dx_workflow.md` (always updated on init) + user customizations in `workflow.md` (preserved across re-init). Prohibited changes section prevents lint-suppress-only commits.
- **Stats fix:** Childless features now counted in `get_prd_status` totals.
- **Config routing:** `sourcevision.*` config keys now route to `.n-dx.json` for zone pin management.

### Web Dashboard
- Zone slideout shows "pinned" badge on files with zone pin overrides.
- Server augments `/api/sv/zones` response with zone pins from `.n-dx.json`.

### CLI
- Fix release workflow: use bash wrapper script for changeset version command (changesets/action splits on whitespace without a shell).
