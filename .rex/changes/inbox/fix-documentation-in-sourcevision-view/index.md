---
id: "a7e09490-34bb-4b1d-ad69-a67c94cf167b"
type: "change"
title: "Fix documentation in sourcevision-view-tests (1 finding)"
slug: "fix-documentation-in-sourcevision-view"
intent: "- Zone name 'sourcevision-view-tests' is semantically misleading. These tests cover web viewer tabs that display sourcevision-derived data, not the sourcevision analysis package. The name will cause contributor confusion and test misplacement as the package grows, particularly since the real sourcevision test suite lives in a different package."
priority: "high"
source: "sourcevision"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "SourceVision section runs the full analysis flow with all tabs and recommendations visible" (a83b1a2f-8315-4ba6-b10b-d70ba4f68479).
