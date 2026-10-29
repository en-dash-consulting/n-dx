---
id: "0c1401b1-5398-41c9-bc05-98d172048518"
type: "task"
title: "A drive-relative bin path such as D:evil.js passes validation and resolves outside the package"
slug: "a-drive-relative-bin-path-such-as-d"
description: "Verdict: should-fix. checkPackagePath (packages/core/extension-manifest.js:598-599) accepts 'D:evil.js' (reproduced), and dispatch's resolve(ext.dir, bin) (extension-dispatch.js:124,185) yields D:\\evil.js relative to D:'s cwd. The published schema forbids ^[A-Za-z]:, so validator and schema disagree. Fix: reject /^[A-Za-z]:/ in checkPackagePath, add 'D:cli.js' to the escape test (tests/unit/extension-manifest.test.js), and at dispatch check the resolved path is still under the package dir."
acceptanceCriteria:
  - "A drive-relative bin, sidecar.bin or configSchema path is invalid under package-path"
  - "Dispatch refuses a bin whose resolved path is outside the package directory"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
