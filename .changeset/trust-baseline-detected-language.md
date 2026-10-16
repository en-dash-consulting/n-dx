---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Repository trust takes the guard baseline from marker files (`go.mod`, `Package.swift`, an Xcode project), not from the `language` the repository declares. A JS/TS checkout declaring `swift` no longer gets `xcodebuild` and `xcrun` without trust: it reports a `language-mismatch` warning, needs `ndx trust accept .`, and hench clamps it to the JS/TS baseline until then.
