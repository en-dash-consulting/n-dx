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

1. Run `git status --porcelain`. If the output is empty, print "Working tree clean — nothing to commit." and stop.
2. Run `git add -A` to stage all changes.
3. Commit with a message that names the key changed: `git commit -m "ndx-config: update <key> configuration"`
