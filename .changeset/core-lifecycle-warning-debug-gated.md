---
"@n-dx/core": patch
---

Stop printing the child-lifecycle process-group warning on every Windows `ndx` invocation.

`packages/core/cli.js` builds its child-process tracker with `processGroups: true` at module load, and `createChildProcessTracker` emitted the fallback notice at construction time. Because `PLATFORM_SUPPORTS_PROCESS_GROUPS` is always `false` on win32, every command — including `ndx --version`, `ndx --help`, and `ndx status`, none of which spawn a child — prefixed its output with:

```
[child-lifecycle] process group cleanup is not supported on this platform; falling back to direct child kill
```

The message read as a degradation, but direct child kill is the intended Windows path — `cli.js` already omits `detached: true` on win32 by design, so there was nothing for users to act on.

The notice is now opt-in behind `NDX_DEBUG_LIFECYCLE` (or the global `NDX_DEBUG`), matching the existing `NDX_DEBUG_LLM` / `NDX_DEBUG` convention in `@n-dx/llm-client`. Set either to `1`, `true`, or `yes` to restore it when diagnosing child-cleanup behavior. Termination behavior is unchanged on all platforms; only the logging is gated. The `stripKnownRuntimeNoise` filter in `scripts/cli-smoke-parity.mjs` is retained so smoke output stays comparable against older installs and debug-enabled runs.
