---
"@n-dx/rex": patch
---

Removed the test-only `writePRD` option `omitSlugRuleMarker` (`tests/helpers/rex-dir-test-support.ts`): nothing called it, so the absent-marker branch it existed to reach was never exercised through it — the branch is already covered directly in `tests/unit/store/slug-rule-guard.test.ts`, which writes `tree-meta.json` without the marker on disk. No production code changed.
