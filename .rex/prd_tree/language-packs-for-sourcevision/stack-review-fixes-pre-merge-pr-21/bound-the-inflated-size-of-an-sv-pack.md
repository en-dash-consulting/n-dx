---
id: "c4007c66-44d0-4603-8ec9-18141a9eadca"
level: "task"
title: "Bound the inflated size of an sv pack bundle before reading it"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "sv-pack"
  - "security"
  - "pr-21"
source: "review"
acceptanceCriteria:
  - "A bundle whose inflated size exceeds the declared limit is refused with an ArchiveError before any tar entry is parsed or extracted"
  - "sv pack add --from with such a bundle prints the existing \"not a usable pack bundle\" error and exits non-zero, with no allocation crash"
  - "A test covers the over-limit case without allocating the real limit, and the existing pack-archive and sv pack tests pass"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
description: "**should-fix (medium).** Review: Hal on #772 (F1), 2026-10-20.\n\n`packages/sourcevision/src/cli/commands/pack-archive.ts:161` calls `gunzipSync(archive)` with no `maxOutputLength`, and every check (tar checksum, truncation, `safePath`) runs on the already-inflated buffer. `readTarGz` then holds every entry at once. A small `--from` bundle that inflates to gigabytes (about 1 MB of gzipped zeros) exhausts memory before validation, so `sv pack add <lang> --from bundle.tgz` dies on an allocation failure instead of reporting an `ArchiveError`.\n\nFix: declare a bundle size constant (a pack plus its node_modules is tens of MB; 512 MiB is generous), pass it as `gunzipSync(archive, { maxOutputLength: MAX_BUNDLE_BYTES })`, and turn the zlib range error into an `ArchiveError` so it reaches the existing \"not a usable pack bundle\" message. Test it with a small gzip that inflates past a lowered limit (make the limit injectable for the test rather than allocating hundreds of MB). Add a `@n-dx/sourcevision` patch changeset."
lastModified: "2026-10-20T14:42:18.452Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
