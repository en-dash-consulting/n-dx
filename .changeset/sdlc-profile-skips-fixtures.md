---
"@n-dx/sourcevision": patch
---

The SDLC profile no longer reads files under `fixtures/`, `__fixtures__/`, `testdata/` or `__mocks__/` directories, matched in any case. A test fixture's `package.json`, `go.mod`, `CODEOWNERS` or pre-commit config used to count as the repository's own readiness evidence, which could raise a score for a practice the repository does not have. Test files under `tests/` still count. Readiness scores can drop after the next analysis: n-dx's own went from 88 to 74, because its feature-flag, observability and quality-gate evidence came from one test fixture.
