---
id: "cb9b167b-479f-4ae5-b618-52fe27fa4211"
type: "task"
title: "Redirects a sidecar builds from X-Ndx-Base-Path, as the docs advise, are double-prefixed"
slug: "redirects-a-sidecar-builds-from-x-ndx"
description: "Verdict: should-fix. proxy.ts:383-386 prepends the prefix to every root-relative Location, so a docs-compliant 302 Location: /x/hello/done reaches the browser as /x/hello/x/hello/done (docs/extensions/hub-api.md:21 says to build absolute links from the header). No test covers a sidecar redirect. Fix: for sidecars, skip the rewrite when Location equals the prefix or starts with prefix + '/'."
acceptanceCriteria:
  - "A sidecar redirect to a path already under its base path is forwarded unchanged"
  - "A sidecar redirect to a root-relative path is still mapped under the mount"
  - "Both are covered by tests"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
