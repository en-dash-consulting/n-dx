---
"@n-dx/hench": patch
---

Stop assuming every project is JS/TS during `hench init`.

- Detect Swift projects (`Package.swift`, `*.xcodeproj`, `*.xcworkspace`) and
  apply a Swift guard profile: `allowedCommands: ["swift", "make",
  "xcodebuild", "xcrun", "git"]`, Swift-aware blocked paths
  (`.build/`, `DerivedData/`, `Pods/`, `Carthage/`), and longer timeouts to
  fit Xcode build times. Adds `"swift"` to `ProjectLanguage`.
- `autoDetectTestCommand` now prefers a Makefile `validate` target over the
  raw language toolchain — a strong "project author wrapped the full gate
  here" signal — and falls back to per-language defaults for Swift (`swift
  test`), Cargo (`cargo test`), Go (`go test ./...`), and Python (`pytest`)
  before giving up.

Net effect: on a Swift codebase with a `make validate` gate, `ndx init`
yields a usable `.hench/config.json` with the right toolchain allowed AND
the resolver picks up `make validate` automatically — no manual
`hench.fullTestCommand` override needed.
