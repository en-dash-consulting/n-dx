---
"sourcevision": minor
---

Feed the detected project profile into the LLM finding prompt with hard
constraints that suppress recommendations that don't fit the project's shape:

- When `importGraphQuality` is `sparse` or `absent` (e.g. a Swift, Rust, or
  Python project with no resolvable JS/TS imports), the LLM is told NOT to
  emit structural findings — those zones come from file-tree proximity and
  can't carry meaningful coupling/cohesion claims.
- When the repo already has release infrastructure (release-please,
  changesets, package.json, Cargo, pyproject, git-tag build scripts), the LLM
  is told NOT to recommend introducing a VERSION file or competing release
  scheme.
- When SwiftUI is detected as a framework, the LLM is told not to recommend
  MVVM coordinator/view-model transplants or protocols-for-testability by
  default.
- When the primary language is anything other than TS/JS, the LLM is told not
  to propose JS/TS-specific patterns (e.g. Combine `.replaceError` on a sink
  whose `Failure` is `Never`).
- Conditional "If X then Y" findings must be confirmed and rewritten as facts
  or omitted.
