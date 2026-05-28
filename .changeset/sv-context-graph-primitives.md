---
"sourcevision": patch
---

Phase 0 of the context-graph rework: introduces three foundational primitives
that downstream finding/zone consumers will gate on.

- `Zone.evidenceSources?` (imports / proximity / declared / pinned) and
  `Zone.confidence?` so consumers can distinguish import-graph-backed zones
  from proximity-only fallbacks.
- `Finding.anchors?` (file/line/symbol coordinates) and `Finding.confidence?`
  so unverified hypotheses can be filtered before reaching the user.
- New `.sourcevision/project-profile.json` (`ProjectProfile` type) capturing
  primary language, detected frameworks (SwiftUI, AppKit, React, …),
  release infrastructure (release-please, changesets, Cargo, pyproject,
  git-tag build scripts), build and CI surfaces, and import-graph quality.

No behavior changes yet — schema fields are optional and the profile file is
emitted but not yet consumed by the finding prompt. Subsequent commits gate
structural findings on `importGraphQuality` and suppress recommendations
that contradict detected release infrastructure.
