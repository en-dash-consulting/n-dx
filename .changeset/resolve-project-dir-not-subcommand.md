---
"@n-dx/core": patch
---

Stop resolving a tool subcommand as the project directory.

Before dispatch, `main()` infers a directory to read `.n-dx.json` from and to
check whether the project is initialized. It used the same last-positional rule
the command handlers use — but a tool-delegation call still carries its
subcommand in those args, so `ndx hench record --task=X --status=completed`
resolved the project directory to `./record`, and `ndx rex status --format=json`
to `./status`.

Two things followed, neither of them loud. `checkProjectStaleness` looked for
`.rex`, `.hench` and `.sourcevision` under a path that does not exist and printed
"Project setup incomplete — run ndx init to initialize" in a fully initialized
project. And `loadProjectConfig` read `.n-dx.json` from that same path and fell
back to `{}`, so `commandTimeouts` and BETA experimental flags silently stopped
applying to any `ndx rex|hench|sourcevision|sv <subcommand>` call without a
trailing directory. The delegated tool itself was unaffected — it resolves its
own directory — which is why the symptom was a false warning and dropped config
rather than a failed command.

That call site now uses `resolveExistingDir`, which accepts a positional only
when it names a real directory. This is safe there specifically because the
result is never an operation target: a path that does not exist has no config to
read, so falling back to the cwd loses nothing. The 25 handler call sites keep
the existing rule, so a directory the user intends to create — `ndx init newdir`
— still resolves as before. The stricter rule also fixes the same misfire for a
non-path positional, such as `ndx rex add "some description"`.
