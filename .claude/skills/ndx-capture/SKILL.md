---
name: ndx-capture
description: Capture a requirement, feature idea, or task from conversation context
argument-hint: "[description]"
---

Capture a requirement, feature idea, or task from conversation context.

**Before anything else, note the current time in ISO-8601.** Use whatever your shell provides — `date -Iseconds` on POSIX shells, `Get-Date -Format o` in PowerShell. The record step at the end passes it as `--startedAt`, which is what stops this run from claiming every token the session spent before it began.

1. If a description is provided, use it. Otherwise, review recent conversation for feature requests, requirements, or product decisions
2. Call `get_prd_status` (rex MCP) to understand current PRD structure
3. Determine the appropriate `level` — required by `add_item`, with no default, so decide it rather than letting it be guessed:
   - Epic: large initiative spanning multiple features
   - Feature: a capability or user-facing behavior
   - Task: a concrete, implementable work item
4. Find the appropriate parent by matching to existing epics/features
5. Draft the item against the fields `add_item` actually takes: `title`, `description`, and `acceptanceCriteria` — the last as an array, one criterion per entry. Do not write the criteria into `description` prose: `verify_criteria` (rex MCP) and the dashboard's requirements view read the `acceptanceCriteria` field, so criteria buried in prose can never be mapped to tests or checked by a later review. Set `source` to `ndx-capture` so the item's provenance outlives the conversation
6. Present to the user for confirmation before creating
7. Use `add_item` (rex MCP) to create, then confirm placement in hierarchy
8. Check for dependencies: does this item block or depend on other pending items? If so, set `blockedBy` via `edit_item` (rex MCP)
9. **Commit**: run `git status --porcelain` against the project root — this catches MCP side-effect writes (e.g. `add_item` and `edit_item` write to `.rex/prd_tree/<slug>/index.md`) even when no files were edited directly. If the output is empty, print "Working tree clean — nothing to commit." and stop. Otherwise stage all changes with `git add -A` and commit with the n-dx authorship + model audit trailer block . Build the message with your file-writing tool, never with shell quoting: heredocs and `$(...)` are POSIX-only and fail in PowerShell/cmd.exe (Git Bash is not part of Windows), and repeated `-m` flags insert blank lines that split the trailer block so git stops parsing it. Write exactly this message to a scratch file such as `.git/NDX_COMMIT_MSG`:

   ```
   ndx-capture: add '<title>' to PRD

   N-DX: skill/ndx-capture
   Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
   ```

   Then run `git commit -F .git/NDX_COMMIT_MSG` and delete the scratch file.

   Substitute `<title>` with the captured item title. Keep the `N-DX:` and `Co-Authored-By:` trailer lines exactly as shown — they form the audit trail used by downstream tooling.

## Always do these without being asked

- **Place under a parent** — never leave items at root level. Match to the closest existing epic/feature.
- **Set dependencies** — if multiple items are being captured, or if existing pending items have ordering relationships, wire `blockedBy` edges.
- **Set priority** — infer from context (urgency, blocking status, user language like "critical", "should", "nice to have").

## Record the run and its token cost

After committing, record this run so both the work and the tokens it spent are auditable alongside `ndx work` runs:

```sh
ndx hench record --task=<id> --status=completed --startedAt=<the time you noted>   --title="ndx-capture: <captured item title>"   --summary="<one-line summary>"
```

Token usage is read automatically from this Claude Code session's transcript, counting only the spend since the previous record — so several skill runs in one session each get their own slice instead of all claiming the session total. `<id>` is the id of the item you just created, so the cost of capturing it lands on that item in the PRD rollup.

Skip this only if you changed nothing at all. If no transcript is found the record is still written with zero usage; the command reports which happened.
