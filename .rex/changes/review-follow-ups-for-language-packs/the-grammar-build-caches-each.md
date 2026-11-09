---
id: "4f09740d-b7c7-4a07-8a8a-2c04f26001f4"
type: "task"
title: "The grammar build caches each toolchain twice: re-verified archive and trusted extracted tree"
slug: "the-grammar-build-caches-each"
description: "Found by adversarial review of 8d076b43b (task 069950b8). Verdict: should-fix, low.\n\npackages/lang-runtime/scripts/build-grammars.mjs installToolchain keeps the verified archive in build/cache (wasi-sdk 34.0: about 180-190 MB on macOS and Linux, 620 MB on Windows; binaryen: 8-117 MB) and also the extracted tree in build/cache/<name>-<version>-<platform>. On every run it reads and re-hashes the archive, then trusts the extracted tree because a `.n-dx-sha256` marker matches. Re-hashing the archive therefore protects nothing: a modified extracted tree is still used.\n\nCI and release now cache all of packages/lang-runtime/build/cache. Before, the archives went to a temp dir, so each OS cache entry grows by the archive size (about 300 MB on Linux, 730 MB on Windows). That adds restore and save time on every grammar leg and pressure on the repo's 10 GB Actions cache.\n\nReachable: every CI leg that builds grammars (ci.yml \"Cache grammar build downloads\", release.yml).\n\nOptions:\n(a) Recommended. Check the marker before fetching. When it matches, skip the fetch. After a successful extraction, delete the archive. Cost: small. Risk: none new, since the extracted tree is already trusted by the marker.\n(b) Exclude the archives from the actions/cache paths. Cost: more YAML globbing. Risk: re-download on each run."
acceptanceCriteria:
  - "After a successful build:grammars run, packages/lang-runtime/build/cache holds no wasi-sdk or binaryen .tar.gz archive"
  - "A second run with a matching marker neither downloads nor re-hashes the toolchain archive (unit test with fetch stubbed)"
  - "A missing or mismatched marker still fetches the archive through fetchVerified and re-extracts it"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-runtime"
  - "ci"
source: "ndx-adversarial-review"
---
