---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Spawn the vendor CLI (Claude CLI provider) with `cwd` set to the caller's project directory instead of inheriting the server process's own cwd.

`createLLMClient`/`createClient` now accept an optional `cwd`, threaded through to `cli-provider.ts`'s `spawnCli` call. The dashboard's Ask route (`routes-sourcevision-ask.ts`) passes `ctx.projectDir`, so an Ask request run against a different project no longer executes the CLI wherever `ndx start` happened to be launched from. Hench's own spawn path already passed `cwd` and is unchanged.
