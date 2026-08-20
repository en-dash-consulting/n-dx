View or change n-dx configuration with guided assistance.

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
3. Commit with a message that names the key changed and includes the n-dx authorship + model audit trailer block via a HEREDOC:

   ```sh
   git commit -m "$(cat <<'EOF'
   ndx-config: update <key> configuration

   N-DX: skill/ndx-config
   Co-Authored-By: En Dash's n-dx <n-dx@endash.us>
   EOF
   )"
   ```

   Keep the `N-DX:` and `Co-Authored-By:` trailer lines exactly as shown — they form the audit trail used by downstream tooling.

## Record the run and its token cost

After committing, record this run so both the work and the tokens it spent are auditable alongside `ndx work` runs:

```sh
ndx hench record --task=<id> --status=completed   --title="ndx-config: set <key>"   --summary="<one-line summary>"
```

Token usage is read automatically from this Claude Code session's transcript, counting only the spend since the previous record — so several skill runs in one session each get their own slice instead of all claiming the session total. Use `--task=skill:ndx-config`. A config change belongs to no PRD item, so it is recorded against a synthetic id that `get_token_usage` reports in its `orphans` bucket.

Skip this only if you changed nothing at all. If no transcript is found the record is still written with zero usage; the command reports which happened.
