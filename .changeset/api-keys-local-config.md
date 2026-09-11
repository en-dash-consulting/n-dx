---
"@n-dx/core": patch
"@n-dx/web": patch
---

Write API keys to `.n-dx.local.json`, never to the shared `.n-dx.json`.

`ndx config claude.api_key` (and `llm.claude/codex/google.api_key`) wrote the
key into `.n-dx.json` — the file that carries zone pins, the vendor and the
dashboard port, that the gitignore template calls safe to commit, and that
`ndx init` never gitignores. Only `*.cli_path` was routed to the gitignored
`.n-dx.local.json`; the help text itself said "stored in .n-dx.json — add to
.gitignore". One `git add -A` put the key on the remote. The 0600 chmod on the
file defends against other local users, not against git.

`*.api_key` now joins `*.cli_path` in the local-only set. Every reader already
merged the local layer over the shared one (core `config.js`, `@n-dx/llm-client`
`loadClaudeConfig`/`loadLLMConfig`), so resolution is unchanged; the dashboard's
`/api/ndx-config` auth-method detection was the one reader that looked at
`.n-dx.json` alone and now merges too, so the footer keeps its ✓.

For projects configured before this: every `ndx config` run warns on stderr
when `.n-dx.json` holds an `api_key`, naming the key and the fix. Re-setting the
key is the migration — it lands in the local file and the shared copy (and the
legacy `claude.*` mirror of an `llm.claude.*` key) is removed. `ndx ci` gains a
`config-secrets` step that fails when a git-tracked `.n-dx.json` contains an
`api_key` and warns when an untracked one does.

Found by the 2026-09-11 adversarial security review (finding A).
