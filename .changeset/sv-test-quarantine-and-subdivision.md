---
"@n-dx/sourcevision": patch
---

Two complementary partitioning fixes that target the "29-file blob with three
concerns glued together" failure mode on small/medium repos.

**A. Quarantine out-of-package tests.** When a test file lives in a
test-only directory (Swift `Tests/<suite>/...`, Vitest/Jest `tests/...`),
strip it out of Louvain entirely and drop it into its own per-suite
`tests-<suite>` zone. Tests routinely import production code heavily, which
previously made Louvain glue the test to whatever it asserted against (a
classic anti-pattern in the partition).

Tests COLOCATED with their package (Go's `internal/foo/foo_test.go` next
to `foo.go`) keep their existing behavior — they stay with the package
because the directory they live in also contains production code, signaling
"this test belongs here." Detection: a test directory is "test-only" iff
no production file shares its directory.

**B. Project-relative subdivision threshold.** `SUBDIVISION_THRESHOLD` was
a flat 50 files, meaning a 29-file zone in a 111-file project (26 % of
the codebase!) never got recursively subdivided. Now `max(12,
floor(totalFiles * 0.15))` — any zone over 15 % of the project triggers
subdivision regardless of how high its measured cohesion is, because high
cohesion at large size usually means "many concerns connected by shared
vocabulary," not "one tight thing."
