---
name: ndx-reshape
description: Restructure the PRD hierarchy — regroup epics, change levels, merge overlaps, create new containers
---

Restructure the PRD hierarchy to keep it organized as a coherent product spec.

Use this when the PRD has grown organically and needs cleanup: too many top-level epics, features that should be tasks, overlapping areas that should be merged, or items that belong under different parents.

**Before anything else, note the current time in ISO-8601.** Use whatever your shell provides — `date -Iseconds` on POSIX shells, `Get-Date -Format o` in PowerShell. The record step at the end passes it as `--startedAt`, which is what stops this run from claiming every token the session spent before it began.

## Process

1. Call `get_prd_status` (rex MCP) to see the full epic/feature structure and item counts
2. Analyze the current structure for problems:
   - **Too many epics** — related epics that should be features under a broader epic
   - **Wrong levels** — epics with no children that are really tasks, features that are really subtasks
   - **Overlapping areas** — multiple epics/features covering the same domain
   - **Orphaned items** — tasks at root level that belong under an existing epic
   - **Naming inconsistency** — similar items with different naming conventions
3. Propose a target structure to the user:
   - Group related epics into ~7-12 top-level epics max (one per product area)
   - Each epic should have 3-15 features; each feature should have 2-10 tasks
   - Suggest new parent epics if needed to group scattered items
   - Suggest level changes (epic->feature, feature->task, etc.)
   - Suggest merges for overlapping items
4. After user approval, execute the restructuring:
   - Create new parent epics/features with `add_item` (rex MCP). Set `level` explicitly (`epic` or `feature` — it is required and has no default) and `parentId` for anything that is not a new top-level epic, so a new container never lands at root by accident. A container usually needs no acceptance criteria; when one does have a testable outcome of its own, put them in the `acceptanceCriteria` array rather than in `description`, since that is the field `verify_criteria` and the dashboard's requirements view read
   - Reparent items with `move_item` (rex MCP)
   - Change levels with `edit_item` (rex MCP) using the `level` field
   - Merge overlapping items with `merge_items` (rex MCP)
   - Rename items for consistency with `edit_item` (rex MCP)
5. Run `reorganize` (rex MCP) with mode `fast` to verify no structural issues remain
6. Show the updated structure via `get_prd_status`
7. **Commit**: run `git status --porcelain` against the project root — this catches every MCP-driven write under `.rex/prd_tree/` (`move_item`, `merge_items`, `edit_item`, `add_item`, and `reorganize` all mutate the folder tree). If the output is empty, print "Working tree clean — nothing to commit." and stop. Otherwise stage all changes with `git add -A` and commit with the n-dx authorship + model audit trailer block . Build the message with your file-writing tool, never with shell quoting: heredocs and `$(...)` are POSIX-only and fail in PowerShell/cmd.exe (Git Bash is not part of Windows), and repeated `-m` flags insert blank lines that split the trailer block so git stops parsing it. Write exactly this message to a scratch file such as `.git/NDX_COMMIT_MSG`:

   ```
   ndx-reshape: restructure PRD hierarchy

   N-DX: skill/ndx-reshape
   Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
   ```

   Then run `git commit -F .git/NDX_COMMIT_MSG` and delete the scratch file.

   Keep the `N-DX:` and `Co-Authored-By:` trailer lines exactly as shown — they form the audit trail used by downstream tooling.

## Guidelines

- **Batch by area**: restructure one domain at a time, confirm with the user, then move on
- **Preserve meaning**: when changing levels or merging, keep the original intent clear in descriptions
- **Natural groupings**: organize by product area (e.g., SourceVision, Rex, Hench, Web, CLI, Infrastructure) rather than by work type (bugfixes, features, refactors)
- **Living spec**: the PRD should read as a product spec, not a task backlog. Epic titles should describe product capabilities, not work items
- **Level cascade**: when demoting an epic to a feature, its children may need to move down too (features->tasks, tasks->subtasks)

## MCP Tools Used

- `get_prd_status` — read current structure
- `add_item` — create new parent containers
- `move_item` — reparent items under new parents
- `edit_item` — change level, rename, update descriptions
- `merge_items` — consolidate overlapping items
- `reorganize` — verify structural health after changes

## Record the run and its token cost

After committing, record this run so both the work and the tokens it spent are auditable alongside `ndx work` runs:

```sh
ndx hench record --task=<id> --status=completed --startedAt=<the time you noted>   --title="ndx-reshape: <what was restructured>"   --summary="<one-line summary>"
```

Token usage is read automatically from this Claude Code session's transcript, counting only the spend since the previous record — so several skill runs in one session each get their own slice instead of all claiming the session total. Use `--task=skill:ndx-reshape`. Restructuring spans many items, so it is recorded against a synthetic id that `get_token_usage` reports in its `orphans` bucket rather than charging a single item.

Skip this only if you changed nothing at all. If no transcript is found the record is still written with zero usage; the command reports which happened.
