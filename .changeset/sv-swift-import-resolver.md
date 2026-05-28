---
"@n-dx/sourcevision": patch
---

Add a Swift import + symbol-reference resolver so sourcevision produces a real
file→file graph on Swift codebases instead of falling back to proximity-only
zone detection. Swift's `import X` references modules, not files, so a literal
import parser would produce zero internal edges — this resolver does two
passes: (1) external `import X` for framework detection (Foundation, SwiftUI,
AppKit, etc., classified against an Apple stdlib list), and (2) a project-wide
declaration index (`class/struct/enum/protocol/actor/extension/typealias`)
plus a reference scan that emits an internal edge for each project-declared
symbol used in another file. Comments and string literals are stripped before
both passes so doc-comment mentions don't produce phantom edges.

The result is that `importGraphQuality` flips from `"absent"` to `"rich"` on a
typical SwiftUI app — Louvain produces meaningful zones with real cohesion,
and the prompt-side gating no longer needs to suppress every structural
finding on the project.
