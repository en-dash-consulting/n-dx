---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Commands the repository owns no longer see your credentials. The test gate,
post-task tests, `pnpm audit` / `pnpm outdated`, requirement validation commands,
the cleanup typecheck, completion validation and rex's `verify_criteria` test
command now run with the same credential filter as the agent's shell
(`guard.env`), instead of inheriting the whole parent environment (#686).

A `guard.env.allow` entry that the repository ships (`.hench/config.json` or the
`hench` section of `.n-dx.json`) reaches these commands only while you trust the
repository (`ndx trust accept .`). Entries in your git-ignored
`.n-dx.local.json` always apply.
