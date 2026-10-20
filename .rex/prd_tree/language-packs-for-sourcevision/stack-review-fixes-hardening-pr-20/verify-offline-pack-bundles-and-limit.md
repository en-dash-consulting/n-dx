---
id: "2a03335a-8a5b-4226-88cd-9fa3a61798e7"
level: "task"
title: "Verify offline pack bundles and limit what they replace"
status: "completed"
priority: "high"
tags:
  - "review-fixes"
  - "security"
  - "sourcevision"
  - "pr-20"
source: "review"
startedAt: "2026-10-17T10:18:27.941Z"
completedAt: "2026-10-17T10:27:59.909Z"
endedAt: "2026-10-17T10:27:59.909Z"
resolutionType: "code-change"
resolutionDetail: "sv pack bundle writes/prints SHA-256 (<bundle>.sha256); add --from --sha256 refuses mismatch before parse/extract/import, sidecar checked if present, else 'Not verified'; replaceInstalled moves only dependencyClosure (never another pack). Docs + help state trust model. Commit 4c3f4af54."
acceptanceCriteria:
  - "sv pack bundle emits a SHA-256; add --from --sha256 refuses a mismatch before extracting or importing"
  - "replaceInstalled touches only the named pack and its dependency closure"
  - "Docs describe the trust model; tests cover mismatch, match and an extra-pack bundle"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Builds on the pack-dir lock task just before it. The hench sandbox may block the network; bundles are tested with local fixtures."}
description: "Stack review (#772, pack.ts around line 392). An offline bundle has no integrity check, its code runs during staging, and it can replace packs other than the one named:\n- n-dx-pack-bundle.json is self-declared and carries no hash;\n- npm's integrity data is dropped, because .package-lock.json is filtered out;\n- loadPack imports the bundle's JS from the stage, so a tampered .tgz executes as soon as add --from runs;\n- replaceInstalled then moves every top-level package in the bundle over its namesake, so a modified \"go\" bundle can also swap out the installed @n-dx/lang-java or lang-kit.\n\nThe docs' \"checks the manifest\" reads like verification, and it isn't.\n\nFix:\n- `sv pack bundle` prints a SHA-256 and writes it next to the bundle (<bundle>.sha256);\n- `sv pack add <id> --from <file> --sha256 <hex>` refuses a mismatch before extracting or importing anything. Without --sha256, it prints the bundle's hash and says it was not verified. Use a sidecar .sha256 automatically only if one sits next to the bundle, and say so;\n- replaceInstalled moves only the named pack plus its package.json dependency closure;\n- the docs say plainly that a bundle is trusted like any npm tarball, and how to verify it.\n\nTests: a hash mismatch is refused with nothing extracted; a matching hash installs; a bundle carrying an extra pack does not replace it."
lastModified: "2026-10-17T10:28:00.229Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
