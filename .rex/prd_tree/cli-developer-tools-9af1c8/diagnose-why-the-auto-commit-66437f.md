---
id: "66437fad-2881-47b9-9e37-8c9c34bbd600"
level: "task"
title: "Diagnose why the auto-commit step does not fire after MCP-driven PRD mutations in Claude Code skills"
status: "completed"
priority: "high"
tags:
  - "skills"
  - "auto-commit"
  - "bug"
  - "mcp"
source: "smart-add"
startedAt: "2026-06-02T16:03:44.289Z"
completedAt: "2026-06-02T16:11:39.629Z"
endedAt: "2026-06-02T16:11:39.629Z"
resolutionType: "acknowledgment"
resolutionDetail: "Diagnostic only — no code change. Root cause: the SKILL.md body containing step 9 (`git status --porcelain` → `git add -A` → `git commit`) is not loaded into Claude Code for `/ndx-capture` in this project. Two factors: (1) `.claude/skills/` is gitignored (.gitignore:29) and `ndx init` was not re-run after commit e9bbc4240 (May 28) added step 9, so `.claude/skills/ndx-capture/SKILL.md` is absent — confirmed in this checkout (only `dev-link/` and `triage/` are installed) and in the current session's available-skills list (no `ndx-*` entries). Claude falls back to user-level `~/.claude/skills/ndx-capture/SKILL.md` (if any), which may predate step 9. (2) `.claude/settings.json` does not auto-approve `git status/add/commit` — even when the up-to-date body reaches the LLM, step 9 stalls on permission prompts. Live evidence: this checkout has uncommitted MCP-driven prd_tree changes from a prior reshape (auto-commit-on-completion-for-efac37 deleted, skill-auto-commit-regression-efac37 added). All three failure modes from the brief (a/b/c) are ruled out by code review: status --porcelain reads the full working tree, prd_tree is git-tracked, and the MCP server cwd matches the LLM Bash cwd. tests/integration/skill-commit-behavior.test.js (14/14) proves the documented logic works against a synthetic MCP-style write. The bug is upstream of the logic: the skill text does not reach the LLM. Reproduction and fix outline recorded via append_log; fix is owned by sibling task ae7938a4-3e76-43cd-88e3-b91bb08d21bd."
acceptanceCriteria:
  - "Root cause is identified: whether the commit gate skips MCP-dirtied files, the porcelain check runs against the wrong directory, or the condition short-circuits early"
  - "Reproduction steps documented for /ndx-capture producing a dirty prd_tree without triggering auto-commit"
description: "Examine the auto-commit implementation in the file-modifying skills (particularly /ndx-capture) to identify whether the commit gate checks only direct file edits, ignores MCP-side-effect writes, or runs a working-directory check that returns clean because MCP writes land outside the watched path. Confirm whether git status --porcelain is invoked at all and whether its output is correctly interpreted when prd_tree files are staged."
---
