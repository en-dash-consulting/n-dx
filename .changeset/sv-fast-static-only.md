---
"@n-dx/sourcevision": patch
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

`sv analyze --fast` now makes no model or network calls: no TypeSafe (Jev) judgment requests and no `claude_commands.log` in the project, even with a TypeSafe key set.

Action needed: a run that relied on Jev judgments (move, finding, fragility, typed-finding grading) while passing `--fast` gets none now; drop `--fast` to keep them.

Every judgment route resolves to none under `--fast`, and a text-model call is refused, so no phase can reach a model whatever keys or config exist. The `rex tree` and `rex tree-diff` reads behind `pr-markdown.md`, and the `ps` liveness check, are no longer written to `claude_commands.log`: they are not vendor-CLI calls. `pr-markdown.md` is unchanged. `execFileSyncCli` takes `logInvocation: false` for such calls.
