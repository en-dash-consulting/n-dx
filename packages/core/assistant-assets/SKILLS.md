# n-dx Claude Code Skill Inventory

Reference for skill authors: every skill is classified by mutation footprint. File-modifying skills **must** include a terminal commit step. Skills invoked inside the hench agent run loop must not be modified to add external commit steps.

---

## Classification Table

| Skill | Source file | Category | What it writes | Commits | In hench loop? |
|-------|-------------|----------|---------------|---------|----------------|
| `ndx-config` | `skills/ndx-config.md` | **file-modifying** | `.n-dx.json`, `.rex/config.json` | ✓ | No |
| `ndx-plan` | `skills/ndx-plan.md` | **file-modifying** | `.rex/prd_tree/` (via `add_item` MCP) | ✓ | No |
| `ndx-capture` | `skills/ndx-capture.md` | **file-modifying** | `.rex/prd_tree/` (via `add_item`/`edit_item` MCP) | ✓ | No |
| `ndx-reshape` | `skills/ndx-reshape.md` | **file-modifying** | `.rex/prd_tree/` (via `add/move/edit/merge` MCP) | ✓ | No |
| `ndx-status` | `skills/ndx-status.md` | read-only | — | — | No |
| `ndx-zone` | `skills/ndx-zone.md` | read-only | — | — | No |
| `ndx-feedback` | `skills/ndx-feedback.md` | read-only† | — | — | No |
| `no-plan-mode` | `skills/no-plan-mode.md` | read-only (rule) | — | — | ⚠ applies to hench |
| `ndx-work` | `skills/ndx-work.md` | **out-of-scope** | via hench lifecycle | via hench | ⚠ IS the loop |
| `dev-link` | `.claude/skills/dev-link/SKILL.md` | file-modifying‡ | global pnpm links | — | No |
| `triage` | `.claude/skills/triage/SKILL.md` | read-only by default§ | — | — | No |

### Notes

**†ndx-feedback** — calls `gh issue create` (external write to GitHub), not a local file change. No commit warranted.

**‡dev-link** — modifies global pnpm package symlinks, not project files. Changes are outside the repo working tree. No commit step is applicable; the effect is tooling-level, not source-level.

**§triage** — dry-run by default. Can close GitHub issues and update project board fields when the user explicitly authorizes it. All mutations are external (GitHub API); no local files are touched. No commit warranted.

**no-plan-mode** — the rule text in `no-plan-mode.md` describes behavior enforced inside the hench system prompt (`packages/hench/src/agent/planning/prompt.ts`). The skill file exists as documentation for Claude Code users, not as a behavior injected at invocation time. Never add a commit step here.

**ndx-work** — the hench agent run loop. Hench has its own commit lifecycle (`packages/hench/src/agent/shared.ts`). Adding a commit step to this skill would double-commit. Strictly out of scope for the auto-commit pattern.

---

## Rules for new skills

1. **Read-only** — no commit step. Document which MCP tools / CLI commands you call.
2. **File-modifying (local files)** — add a terminal commit step:
   ```
   Run `git status --porcelain`. If empty, print "Working tree clean — nothing to commit." and stop.
   Run `git add -A` then `git commit -m "<skill-name>: <concise description of what changed>"`.
   ```
3. **File-modifying (external only — GitHub, npm, global links)** — no commit step. Note in this table why.
4. **Hench loop skills** — flag as out-of-scope in this table. Do not add commit steps.
5. **Update this table** when adding or removing a skill.
