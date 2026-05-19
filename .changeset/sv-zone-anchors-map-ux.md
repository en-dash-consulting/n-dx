---
"@n-dx/sourcevision": minor
"@n-dx/web": patch
---

SourceVision zone-pin determinism, analyze stability, and Map UX.

**SourceVision** — Stop spurious enrichment-pass resets on a no-op `analyze`
(partition-independent input fingerprint reused when code/config is unchanged).
Zone pins whose target zone did not form are no longer silently dropped — a
grouped warning finding is emitted (issue #210, part 1). New
`sourcevision.zones.anchors` config declares a named zone from a file glob that
is forced to exist, making single-target pin consolidations deterministic
across runs (issue #210, part 2). `.rex/` and `.hench/` are excluded from the
file inventory so generated PRD markdown / run logs no longer skew Overview
language stats.

**Web** — Codebase/Zone Map overhaul: deterministic grouped grid layout (no
overlap), flexbox-centered node labels, cursor-anchored bounded zoom/pan
(wheel + touch pinch), near-fullscreen File Street View modal, Escape as a
hierarchical back, and a non-hijacking hover hint. Quick Add now resolves the
rex CLI from the server's own install (fixes `Cannot find module` for non-n-dx
projects) with a longer smart-add timeout and an actionable no-API-key error.
