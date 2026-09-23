---
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

test(ci): stop the intermittent Windows CI failures — hook budgets and rm retries

Test and CI configuration only; no production code changes and no test's
assertions or behaviour change. Published output is unaffected — these packages
ship `dist` only.

`CLI Smoke (Windows)` was failing intermittently with two symptoms, both
environmental rather than defects in the code under test.

- **`hookTimeout` was never set anywhere.** Vitest defaults it to 10s, so every
  config that raised `testTimeout` left its setup hooks on that default — a
  `beforeEach` got a third of the budget (hench, rex, sourcevision) or a twelfth
  (root) of the test it exists to prepare. Those hooks do the same work the
  tests do: `mkdtemp`, then `initGitFixtureRepo`'s `git init`/`add`/`commit` as
  subprocesses, which on a loaded Windows runner legitimately exceeds 10s.
  `hookTimeout` is now set alongside `testTimeout` in the five configs that
  raise it. `@n-dx/llm-client` raises neither, so Vitest's defaults already keep
  the hook budget the larger of the two, and it is left untouched.
- **`RM_RETRY` existed and was bypassed.** The helper in
  `packages/hench/tests/helpers` documents exactly this case — on Windows a
  directory cannot be removed while a process holds a handle inside it, and a
  just-signalled `git` child has not necessarily let go by teardown. 32
  git-using hench test files called `fs.rm` directly without it; both files
  observed failing on CI were among them. Failures still propagate, so a lock
  that never clears is still an error rather than a leaked temp directory.

`tests/unit/vitest-timeout-policy.test.js` now pins hook budget ≥ test budget so
a future config cannot silently reintroduce the inversion, and fails closed on a
timeout it cannot parse rather than skipping that config.
