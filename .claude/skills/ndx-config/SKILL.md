---
name: ndx-config
description: View or change n-dx configuration with guided assistance
argument-hint: "[key] [value]"
---

View or change n-dx configuration with guided assistance.

**Before anything else, mark where this run's token usage starts:** run `ndx hench usage mark --task=skill:ndx-config .`. The CLI snapshots the session transcript's cumulative usage and position under that id; the record step at the end computes this run's spend as the difference between that snapshot and the transcript then — arithmetic done by code, not a timestamp typed by hand. If the command reports no session or transcript, continue; the record will say it fell back.

Available configuration areas:
- LLM settings: vendor (claude/codex), model, API keys, CLI paths
- Rex settings: budget thresholds, level-of-effort params, adapter
- Hench settings: provider, model, max turns, token budget, guard policies
- Web settings: dashboard port

If no arguments: show current configuration summary
If key only: show current value and explain what it controls
If key and value: validate and set the value

Run the appropriate `ndx config` command to apply changes.

## Final step — commit configuration changes

After applying any configuration change, commit the modified files:

1. Run `git status --porcelain` against the project root. This catches every dirty path — both direct file edits to `.n-dx.json`/`.rex/config.json`/`.hench/config.json` *and* MCP side-effect writes under `.rex/prd_tree/`. If the output is empty, print "Working tree clean — nothing to commit." and stop.
2. Run `git add -A` to stage all changes.
3. Commit with a message that names the key changed and includes the n-dx authorship + model audit trailer block . Build the message with your file-writing tool, never with shell quoting: heredocs and `$(...)` are POSIX-only and fail in PowerShell/cmd.exe (Git Bash is not part of Windows), and repeated `-m` flags insert blank lines that split the trailer block so git stops parsing it. Write exactly this message to a scratch file such as `.git/NDX_COMMIT_MSG`:

   ```
   ndx-config: update <key> configuration

   N-DX: skill/ndx-config
   Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
   ```

   Then run `git commit -F .git/NDX_COMMIT_MSG` and delete the scratch file.

   Keep the `N-DX:` and `Co-Authored-By:` trailer lines exactly as shown — they form the audit trail used by downstream tooling.

## Record the run and its token cost

After committing, record this run so both the work and the tokens it spent are auditable alongside `ndx work` runs:

```sh
ndx hench record --task=skill:ndx-config --status=completed   --title="ndx-config: set <key>"   --summary="<one-line summary>" .
```

Token usage is computed by the CLI as the difference between the `skill:ndx-config` mark taken at the start and the session transcript now — several skill runs in one session each get exactly their own slice. Use `--task=skill:ndx-config`. A config change belongs to no PRD item, so it is recorded against a synthetic id that `get_token_usage` reports in its `orphans` bucket.

Skip this only if you changed nothing at all. If no transcript is found the record is still written with zero usage; the command reports which happened.

## Done when

The requested setting is written, committed, and recorded. Do not change
settings that were not asked for, and do not run the commands the new setting
affects to "verify" it — a config skill that triggers an analysis or a work run
has done something the user did not ask for. Report the new value instead.
