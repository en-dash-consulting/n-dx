# Generated and machine-local files

Files n-dx writes for itself. None is a source of truth, none is committed,
and every one of them is safe to delete — the next run rebuilds what it
needs. They are listed here rather than in `AGENTS.md` / `CLAUDE.md` because
an assistant reads them at most to diagnose something, never to edit.

| Path | Purpose |
|------|---------|
| `.rex/archive.json` | Pruned/reshaped item archive (written by `rex prune` and `rex reshape`; max 100 batches, auto-trimmed; safe to delete — only used for item recovery/audit) |
| `.hench/usage-cursors/` | Per-session watermarks recording how far through a Claude Code transcript `hench record` has already attributed tokens (machine-local; safe to delete) |
| `.sourcevision/.cache/judgments.json` | Content-addressed cache of Jev answers (question + the state slice it references → answer). Consulted per question inside `askJev`; only misses are sent. Machine-local; safe to delete — the next run re-asks |
| `.sourcevision/.cache/narration.log` | Output of the detached `sv narrate` child that `analyze` spawns for escalated zones in cascade mode; `manifest.narration` holds its status. Machine-local; safe to delete |
| `.sourcevision/.cache/analyses.jsonl` | One line per `sv analyze` run — mode, wall-clock per phase, calls/tokens/time per LLM task class (the same record as `manifest.lastAnalysis`, kept for the last 200 runs). Machine-local; safe to delete |
| `.sourcevision/.cache/analyze-progress.json` | Live progress of the current or last `sv analyze` — phase, enrichment pass, batch k of n, LLM use so far — rewritten as the run moves and marked complete/failed at the end; served as `progress` on `GET /api/commands/sv-analyze/status`. Read it through `readAnalyzeProgress`, which reports a `running` file as `interrupted` when its pid is dead or, where `ps` can tell, now belongs to another program. Machine-local; safe to delete |
| `.n-dx-web-usage.jsonl` | Dashboard LLM spend ledger — one line per Ask call (vendor, model, token classes, outcome). Read by the LLM Utilization view as the `web` package bucket; not attributed to any PRD item. Machine-local; safe to delete |

## See also

- [Architecture Overview](overview.md) — the tiers that own these directories
- [PRD folder-tree schema](prd-folder-tree-schema.md) — the tree the caches derive from
