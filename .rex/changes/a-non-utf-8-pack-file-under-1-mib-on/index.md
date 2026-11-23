---
id: "41906c90-264b-4997-a015-5c9c3c275aa6"
type: "change"
title: "A non-UTF-8 pack file under 1 MiB on disk is skipped and reported as over the 1 MiB parser limit"
slug: "a-non-utf-8-pack-file-under-1-mib-on"
summary: "Old files saved in a pre-Unicode text encoding can be wrongly skipped as too large and reported as over the size limit, even though they are smaller on disk. Measuring the real file size fixes both the skip and the misleading report."
intent: "**Defect.** `packages/lang-runtime/src/runner.ts` `parseSource` checks the size limit with `Buffer.byteLength(source, \"utf8\")` on the already-decoded string. `createPackEntry` (`packages/lang-runtime/src/pack-entry.ts`) decodes each file with `bytes.toString(\"utf8\")`, and every invalid byte becomes U+FFFD, which is 3 bytes in UTF-8. A file of N bytes whose fraction f of bytes is invalid therefore measures N(1+2f). Example: a 700 KiB latin-1 PHP file where 30% of the bytes are high bytes measures 1,120 KiB. It is skipped (no facts) and, since PR 12's parse report, listed in imports.json `summary.parseIssues.<pack>.oversized` and the `[php-parse] … over 1 MiB not parsed` notice, although the file on disk is under 1 MiB. `runner.parseFile` already measures raw bytes (`statSync().size`), so the two paths disagree.\n\n**Reachability.** `sv analyze` / `ndx analyze` with any tree-sitter pack (PHP, Java, Go, Python) over a project holding non-UTF-8 sources between roughly 342 KiB and 1 MiB with many high bytes. Rare in practice (latin-1 text is mostly ASCII), but it is the legacy-estate case PR 12 targets.\n\n**Verdict.** should-fix, low. Found by the adversarial review of task 7ffab98a (run 8c192202). The skip itself predates that task; the misleading report is new with it.\n\n**Options.**\n1. (Recommended) Let `createPackEntry` measure `bytes.length`: pass the raw size to `parseSource` (an optional `sizeBytes` argument the runner uses in place of `Buffer.byteLength`), or check the limit in the entry before decoding. Small change, one test. Risk: a few more files parse, so facts for such files appear where they were absent.\n2. Keep the decoded-size check and word the notice and docs as the decoded size. No behavior change, but it still skips files under the limit."
acceptanceCriteria:
  - "A pack file under the size limit on disk whose bytes are not valid UTF-8 is parsed, and listed only under notUtf8, even when its decoded text exceeds the limit"
  - "A file over the size limit on disk is still listed under oversized and not parsed"
  - "A lang-php integration test builds a latin-1 file under 1 MiB that decodes to over 1 MiB and asserts it is parsed and not oversized"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"7ffab98a-95f7-4d90-86df-e3aad31a3a3c","run":"8c192202-cf1f-4094-b15f-24302e468530"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-runtime"
  - "estate-readiness"
source: "ndx-adversarial-review"
---
