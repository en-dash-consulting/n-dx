Analyze the codebase and propose PRD updates.

**Before anything else, note the current time in ISO-8601.** Use whatever your shell provides — `date -Is` on POSIX shells, `Get-Date -Format o` in PowerShell. The record step at the end passes it as `--startedAt`, which is what stops this run from claiming every token the session spent before it began.

1. Call `get_overview` (sourcevision MCP) to understand current project state
2. Call `get_findings` (sourcevision MCP) to identify anti-patterns and suggestions
3. Call `get_prd_status` (rex MCP) to see existing PRD items and avoid duplicates
4. Call `get_next_steps` (sourcevision MCP) for prioritized recommendations
5. Based on findings, existing gaps, and any user-described goals, propose new epics/features/tasks
6. Present proposals to the user for review
7. For each approved proposal, use `add_item` (rex MCP) to create it with appropriate descriptions, acceptance criteria, and parent placement
8. Show the updated PRD tree via `get_prd_status`
9. **Commit**: run `git status --porcelain` against the project root — this picks up every MCP write under `.rex/prd_tree/` (each `add_item` call produces a new `<slug>/index.md`). If the output is empty, print "Working tree clean — nothing to commit." and stop. Otherwise stage all changes with `git add -A` and commit with the n-dx authorship + model audit trailer block via a HEREDOC:

   ```sh
   git commit -m "$(cat <<'EOF'
   ndx-plan: add <N> proposed PRD items

   N-DX: skill/ndx-plan
   Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
   EOF
   )"
   ```

   Replace `<N>` with the count of items created. Keep the `N-DX:` and `Co-Authored-By:` trailer lines exactly as shown — they form the audit trail used by downstream tooling.

## Record the run and its token cost

After committing, record this run so both the work and the tokens it spent are auditable alongside `ndx work` runs:

```sh
ndx hench record --task=<id> --status=completed --startedAt=<the time you noted>   --title="ndx-plan: accepted <N> proposals"   --summary="<one-line summary>"
```

Token usage is read automatically from this Claude Code session's transcript, counting only the spend since the previous record — so several skill runs in one session each get their own slice instead of all claiming the session total. Use `--task=skill:ndx-plan`. Planning produces many items, so charging one of them for work that created all of them would misattribute it; `get_token_usage` surfaces ids that match no item in its `orphans` bucket, which is the honest place for planning overhead.

Skip this only if you changed nothing at all. If no transcript is found the record is still written with zero usage; the command reports which happened.
