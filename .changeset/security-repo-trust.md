---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Repository trust can no longer be steered by the repository (#686).

- The guard baseline comes from marker files (`go.mod`, `Package.swift`, an Xcode project), not from the `language` the repository declares. A JS/TS checkout declaring `swift` no longer gets `xcodebuild` and `xcrun` without trust: it reports a `language-mismatch` warning, needs `ndx trust accept .`, and hench clamps it to the JS/TS baseline until then.
- `verify_criteria` runs a repository's test command only once the user has accepted this exact execution config with `ndx trust accept .`. Before, a plain command such as `pnpm test` ran on any checkout that was otherwise at the defaults. The command rex actually runs is what the trust digest covers, including a `rex.test` override in the project config; a non-string `test` never runs. Soft freeze: `verify_criteria` keeps its result shape, but `runTests: true` is now refused, with the existing `testsSkipped` note and `trust` field, on a checkout that has a test command and no matching trust record.
- `rex verify` applies the same rule. It still runs tests unless `--dry-run`, but a repository's test command runs only after `ndx trust accept .`; until then it prints the mapping, says to accept, and exits 1, so a CI step with no trust record fails rather than passing without running tests. `--format=json` carries the same `testsSkipped` and `trust` fields as `verify_criteria`.
- `ndx trust accept .` on a checkout whose only deviation is a test command names the command and says verify_criteria and `rex verify` can now run it, instead of "Nothing to trust".
