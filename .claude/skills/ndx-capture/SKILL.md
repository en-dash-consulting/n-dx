---
name: ndx-capture
description: Capture a requirement, feature idea, or task from conversation context
argument-hint: "[description]"
---

Capture a requirement, feature idea, or task from conversation context.

**Before anything else, mark where this run's token usage starts:** run `ndx hench usage mark --task=skill:ndx-capture .`. The CLI snapshots the session transcript's cumulative usage and position under that id; the record step at the end computes this run's spend as the difference between that snapshot and the transcript then — arithmetic done by code, not a timestamp typed by hand. If the command reports no session or transcript, continue; the record will say it fell back.

**Then note what is already dirty:** run `git -c core.quotepath=false status --porcelain --untracked-files=all` against the project root and keep its output. Every path it lists is the user's work in progress, and the commit step at the end stages only paths that are not on this list.

1. If a description is provided, use it. Otherwise, review recent conversation for feature requests, requirements, or product decisions
2. Call `get_prd_status` (rex MCP) to understand current PRD structure
3. Determine the appropriate `level` — required by `add_item`, with no default, so decide it rather than letting it be guessed:
   - Epic: large initiative spanning multiple features
   - Feature: a capability or user-facing behavior
   - Task: a concrete, implementable work item
4. Find the appropriate parent by matching to existing epics/features
5. Draft the item against the fields `add_item` actually takes: `title`, `description`, and `acceptanceCriteria` — the last as an array, one criterion per entry. Do not write the criteria into `description` prose: `verify_criteria` (rex MCP) and the dashboard's requirements view read the `acceptanceCriteria` field, so criteria buried in prose can never be mapped to tests or checked by a later review. Set `source` to `ndx-capture` so the item's provenance outlives the conversation
6. Present to the user for confirmation before creating
7. **Check for overlap first:** if any path on the list you kept at the start is under `.rex/prd_tree/`, name those paths and ask the user to commit or stash them before you write — `add_item` rewrites the parent's and ancestors' `index.md` (their Children tables), so a dirty one would keep part of this change out of the commit. Once they have, run `git -c core.quotepath=false status --porcelain --untracked-files=all` again and keep that output as the list instead; if they decline, carry on, and those paths stay out of the commit. Then use `add_item` (rex MCP) to create, then confirm placement in hierarchy
8. Check for dependencies: does this item block or depend on other pending items? If so, set `blockedBy` via `edit_item` (rex MCP)
9. **Commit**: run `git -c core.quotepath=false status --porcelain --untracked-files=all` against the project root — this catches MCP side-effect writes (e.g. `add_item` and `edit_item` write to `.rex/prd_tree/<slug>/index.md`) even when no files were edited directly. The paths to commit are the ones that are not on the list you kept at the start. If there are none, print "Working tree clean — nothing to commit." and stop. Otherwise stage exactly those paths, naming each one: `git add -- <path> <path> …`. Never `git add -A` or `git add .`: the paths already on the list are the user's work in progress, and staging them would attribute it to this skill. A path still on the list stays out of this commit even if this skill changed it — the user declined to commit or stash it before the write — so name it in your summary as part of the change this commit leaves out. Then commit with the n-dx authorship + model audit trailer block. Build the message with your file-writing tool, never with shell quoting: heredocs and `$(...)` are POSIX-only and fail in PowerShell/cmd.exe (Git Bash is not part of Windows), and repeated `-m` flags insert blank lines that split the trailer block so git stops parsing it. Write exactly this message to `.ndx-commit-msg.txt` at the project root — never under `.git/`, which is a file, not a directory, in a linked worktree:

   ```
   ndx-capture: add '<title>' to PRD

   N-DX: skill/ndx-capture
   N-DX-Item: <id>
   Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
   ```

   Then run `git commit -F .ndx-commit-msg.txt -- <the same paths>` and delete `.ndx-commit-msg.txt`. Name the paths on the commit as well: without them `git commit` takes everything in the index, including anything the user had already staged.

   Substitute `<title>` with the captured item title and `<id>` with the id `add_item` returned — the bare id, never a dashboard URL. Keep the `N-DX:`, `N-DX-Item:` and `Co-Authored-By:` trailer lines exactly as shown — they form the audit trail used by downstream tooling, and `N-DX-Item` is what ties the commit to the item it is for.

## Always do these without being asked

- **Place under a parent** — never leave items at root level. Match to the closest existing epic/feature.
- **Set dependencies** — if multiple items are being captured, or if existing pending items have ordering relationships, wire `blockedBy` edges.
- **Set priority** — infer from context (urgency, blocking status, user language like "critical", "should", "nice to have").

## Record the run and its token cost

After committing, record this run so both the work and the tokens it spent are auditable alongside `ndx work` runs:

```sh
ndx hench record --task=<id> --mark=skill:ndx-capture --status=completed   --title="ndx-capture: <captured item title>"   --summary="<one-line summary>" .
```

Token usage is computed by the CLI as the difference between the `skill:ndx-capture` mark taken at the start and the session transcript now, per token class — several skill runs in one session each get exactly their own slice. `<id>` is the id of the item you just created, so the cost of capturing it lands on that item in the PRD rollup; `--mark` names the mark because the item id did not exist when the run began.

Skip this only if you changed nothing at all. If no transcript is found the record is still written with zero usage; the command reports which happened.

## Done when

The item exists in the PRD, the change is committed, and the run is recorded.
Capturing is the whole job: do not start implementing what was captured, and do
not restructure the surrounding tree to make room for it. Working the item is a
separate run, and reshaping the hierarchy is `/ndx-reshape`.
