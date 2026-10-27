---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/core": patch
---

Repository trust can no longer be steered by the repository (#686).

- The guard baseline comes from marker files (`go.mod`, `Package.swift`, an Xcode project), not from the `language` the repository declares. A JS/TS checkout declaring `swift` no longer gets `xcodebuild` and `xcrun` without trust: it reports a `language-mismatch` warning, needs `ndx trust accept .`, and hench clamps it to the JS/TS baseline until then.
- Every guard baseline blocks every ecosystem's dependency directories at any depth (`**/node_modules/**`, `**/vendor/**`, `**/.build/**`, `**/DerivedData/**`, `**/Pods/**`, `**/Carthage/**`); only the allowed commands depend on the language. A marker file such as a zero-byte `Package.swift`, or a polyglot checkout's root `go.mod`, can no longer drop `node_modules` from an untrusted checkout's clamp, and the clamp keeps the agent out of `web/node_modules/` or a workspace package's `node_modules/` as well as the root's. New hench defaults block all of them; existing configs, including root-only `node_modules/**`, still read as baseline.
- A repository guard that drops its own ecosystem's dependency directory (`node_modules/**` in a JS/TS checkout, `vendor/**` in Go, the Swift set in Swift) now raises a `dependency-paths-removed` warning, so the checkout needs `ndx trust accept .` and is clamped until then. Before, such a guard read as baseline and was never clamped.
- `verify_criteria` runs a repository's test command only once the user has accepted this exact execution config with `ndx trust accept .`. Before, a plain command such as `pnpm test` ran on any checkout that was otherwise at the defaults. The command rex actually runs is what the trust digest covers, including a `rex.test` override in the project config; a non-string `test` never runs. Soft freeze: `verify_criteria` keeps its result shape, but `runTests: true` is now refused, with the existing `testsSkipped` note and `trust` field, on a checkout that has a test command and no matching trust record.
- `rex verify` applies the same rule. It still runs tests unless `--dry-run`, but a repository's test command runs only after `ndx trust accept .`; until then it prints the mapping, says to accept, and exits 1, so a CI step with no trust record fails rather than passing without running tests. `--format=json` carries the same `testsSkipped` and `trust` fields as `verify_criteria`.
- `ndx trust accept .` on a checkout whose only deviation is a test command names the command and says verify_criteria and `rex verify` can now run it, instead of "Nothing to trust".
- `ndx trust .` on such a checkout says whether its test command is accepted, naming the accept command until it is, instead of "nothing to trust". `ndx init` prints that full report too rather than its one-line baseline summary.
- Trust output escapes terminal control characters from repository values. `ndx trust .`, `ndx trust accept .` and the run-time trust warning show ESC, CR, other C0/C1 controls and bidi overrides as `\xNN` / `\uNNNN`, so a test command, allowed command or MCP server entry cannot erase or rewrite the line the user is reviewing. Finding `message` strings carry the escaped form; `values`, the evaluated config and the trust digest keep the raw values.
