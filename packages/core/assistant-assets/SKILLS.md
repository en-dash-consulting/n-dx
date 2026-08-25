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
| `ndx-adversarial-review` | `skills/ndx-adversarial-review.md` | read-only until authorized¶ | `.rex/prd_tree/` (via `add_item`/`edit_item`/`update_task_status` MCP) | ✓ | No |
| `no-plan-mode` | `skills/no-plan-mode.md` | read-only (rule) | — | — | ⚠ applies to hench |
| `ndx-work` | `skills/ndx-work.md` | **out-of-scope** | via hench lifecycle | via hench | ⚠ IS the loop |
| `dev-link` | `.claude/skills/dev-link/SKILL.md` | file-modifying‡ | global pnpm links | — | No |
| `triage` | `.claude/skills/triage/SKILL.md` | read-only by default§ | — | — | No |

### Notes

**†ndx-feedback** — calls `gh issue create` (external write to GitHub), not a local file change. No commit warranted.

**‡dev-link** — modifies global pnpm package symlinks, not project files. Changes are outside the repo working tree. No commit step is applicable; the effect is tooling-level, not source-level.

**§triage** — dry-run by default. Can close GitHub issues and update project board fields when the user explicitly authorizes it. All mutations are external (GitHub API); no local files are touched. No commit warranted.

**¶ndx-adversarial-review** — writes nothing during the review itself (Steps 1–6, including the duplicate check). It becomes file-modifying only after the user explicitly approves findings in Step 5, and then only through rex MCP writes to `.rex/prd_tree/` — a new item, or an `edit_item` addition to one that already tracks the finding. It never edits source and never applies a fix — fixing an approved item is a separate `/ndx-work` run. Because the approved path does write local files, it is declared `"commits": true` and carries the rule-2 commit step, trailers included, in Step 7 — with one deliberate deviation: it stages `git add .rex/prd_tree/` instead of `git add -A`, and scopes its porcelain check the same way. Its diff mode takes the dirty working tree as the review subject, so unscoped staging would commit the user's in-progress work under the review's name.

**no-plan-mode** — the rule text in `no-plan-mode.md` describes behavior enforced inside the hench system prompt (`packages/hench/src/agent/planning/prompt.ts`). The skill file exists as documentation for Claude Code users, not as a behavior injected at invocation time. Never add a commit step here.

**ndx-work** — the hench agent run loop. Hench has its own commit lifecycle (`packages/hench/src/agent/shared.ts`). Adding a commit step to this skill would double-commit. Strictly out of scope for the auto-commit pattern.

---

## Rules for new skills

1. **Read-only** — no commit step. Document which MCP tools / CLI commands you call.
2. **File-modifying (local files)** — declare `"commits": true` in `manifest.json` and add a terminal commit step in exactly this form:

   ````
   Run `git status --porcelain` against the project root. If empty, print
   "Working tree clean — nothing to commit." and stop. Otherwise stage all
   changes with `git add -A` and commit via a HEREDOC:

   ```sh
   git commit -m "$(cat <<'EOF'
   <skill-name>: <concise description of what changed>

   N-DX: skill/<skill-name>
   Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
   EOF
   )"
   ```
   ````

   Both trailer lines are required and must appear verbatim. `Co-Authored-By` is
   what routes the commit to the n-dx identity — `packages/web/src/server/merge-history.ts`
   parses it for the dashboard's merge graph, and GitHub reads it for the
   contribution graph. A commit missing it is invisible to both, silently.

   The `"commits": true` flag is what `tests/e2e/skill-commit-isolation.test.js`
   classifies on. Omit the flag on a skill that commits and the test fails,
   because it will be checked as read-only.

   Exception to `git add -A`: a skill whose *input* is the uncommitted working
   tree (today only `ndx-adversarial-review`, whose diff mode reviews the dirty
   tree) must stage only the paths it wrote (`git add .rex/prd_tree/`) and scope
   its porcelain check the same way — otherwise it commits the very work it was
   reviewing.

3. **File-modifying (external only — GitHub, npm, global links)** — no commit step. Note in this table why.
4. **Hench loop skills** — flag as out-of-scope in this table. Do not add commit steps.
5. **Update this table** when adding or removing a skill.

---

## The `N-DX*` commit-trailer namespace

One namespace, three keys, each answering a different question. They are **not**
variants of one another and should not be unified:

| Trailer | Answers | Example value | Emitted by |
|---------|---------|---------------|------------|
| `N-DX:` | What produced this commit | `skill/ndx-capture`, `claude/opus · run 1f3`, `pre-run commit gate` | skills, hench, `packages/core/commit-trailers.js` |
| `N-DX-Item:` | Which PRD item it is for | a dashboard permalink | hench run loop |
| `N-DX-Status:` | What status changed | `<taskId> in_progress → completed` | hench run loop |

`N-DX:` takes a free-form producer string, so a new commit source picks a value
rather than a new key. `N-DX-Status:` is consumed by
`rex backfill-commit-attribution`.

**Commits created from source, not from a skill** — `packages/core/export.js`
(dashboard deploy) and `packages/core/git-preflight.js` (the `ndx init` baseline
commit) — build their message with `buildCommitMessage()` from
`packages/core/commit-trailers.js`. Core is the orchestration tier and must not
import from packages, so that module necessarily duplicates hench's
`buildCoAuthoredByTrailerLine()`; the two are asserted byte-identical in
`tests/e2e/skill-commit-isolation.test.js`.
