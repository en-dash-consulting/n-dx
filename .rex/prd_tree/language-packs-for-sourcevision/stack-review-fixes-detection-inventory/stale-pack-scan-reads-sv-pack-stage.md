---
id: "7047be28-81f1-4bf4-a1fe-f4fb27cc233d"
level: "task"
title: "Stale-pack scan reads `.sv-pack-stage-*` and same-version copies, so a refusal can say \"pack X@0.9.2 does not match @n-dx/sourcevision@0.9.2\""
status: "in_progress"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "sourcevision"
  - "language-packs"
source: "ndx-adversarial-review"
startedAt: "2026-10-17T06:30:14.524Z"
acceptanceCriteria:
  - "loadPack with packDir under <ndx home>/packs and a pack copy only in <ndx home>/packs/.sv-pack-stage-x returns status \"missing\", not \"mismatch\""
  - "loadPack whose only sibling copy carries the same version as sourcevision returns status \"missing\", not a mismatch naming the same version on both sides"
  - "Unit tests in tests/unit/language/pack-loader.test.ts cover both cases and fail on the current code"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Also fix sibling finding 6378f7e0 in the same run: loadPack must not reject when <ndx home>/packs exists but cannot be listed (treat it as no other-version install, no throw), and mark 6378f7e0 completed with this commit. The stale-pack scan should consider only directories whose name is a valid version other than sourcevision's own, skipping .sv-pack-stage-* and the current version. Keep 121b928b's behaviour otherwise. The hench sandbox may block ~/.cache corpora; leave corpus checks to the session; do not capture follow-ups for them."}
description: "Verdict: should-fix (medium). Introduced by commit 692802362, which addressed task 121b928b (a pack installed for another version used to read as missing).\n\nDefect: `versionInSiblingPackDir` in packages/sourcevision/src/language/pack-loader.ts scans every directory under `<ndx home>/packs` except basename(packDir), and returns whatever version it finds. Two problems follow:\n- It does not skip `.sv-pack-stage-*`, the staging directories that `sv pack add --from` creates beside the version directories (pack.ts:381, `mkdtempSync(join(dirname(packDir), \".sv-pack-stage-\"))`).\n- It does not drop a found version equal to the current one.\n\nScenario 1, `add --from`. A user on 0.9.2 who already has lang-java 0.9.2 installed runs `sv pack add java --from` with a bundle whose node_modules lacks @n-dx/lang-java. The staged loadPack (packDir = the stage dir, whose parent is packsRoot) falls through to resolution, which reports not-found. The sibling scan then finds `packs/0.9.2`, and the error reads \"…cannot be used: pack @n-dx/lang-java@0.9.2 does not match @n-dx/sourcevision@0.9.2 and was not used\". It should say that the bundle does not hold the package.\n\nScenario 2, a stage left behind. A killed `add --from` leaves `packs/.sv-pack-stage-XXXX/node_modules/@n-dx/lang-java` at the current version. Later, with the current version's directory empty, analyze warns \"…@0.9.2 does not match …@0.9.2\" instead of treating the pack as missing (which, for an unlisted pack, means the Optional packs hint).\n\nReachability: edge paths only. One needs a malformed bundle, the other a crashed `add --from`. Normal upgrades are unaffected.\n\nOptions:\n1. (Recommended) In `versionInSiblingPackDir`, skip directory names that start with \".\" and drop found versions equal to `version`. Two conditions and a unit test each. No risk.\n2. Pass the scan root explicitly from callers and disable the scan for the stage load. Touches pack.ts too; more surface."
lastModified: "2026-10-17T06:30:15.789Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
