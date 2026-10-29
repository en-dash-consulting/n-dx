---
id: "e2ad45bb-5c9b-470f-80d2-9effa139db85"
type: "task"
title: "graview-face run with an ambient PORT double-prefixes every URL and renders a blank page"
slug: "graview-face-run-with-an-ambient-port"
description: "Verdict: must-fix (regression from 27ae822a7; cheap). packages/graview-face/bin/serve.js:38 treats any PORT without --port as the hub, setting base /x/graview-face/, and dev/hub-mount.ts:24 prefixes every request unconditionally. Trigger (reproduced): with PORT=3000 in the shell, `ndx-graview-face` prints http://127.0.0.1:3000/x/graview-face/ and GET /x/graview-face/src/main.tsx and /@vite/client answer index.html; the page is blank. The URL printed under the hub is double-prefixed the same way; Vite's direct HMR fallback fails. `ndx graview serve` is unaffected (face.ts deletes PORT). Fix (recommended, both): make hubMount idempotent (prefix only when the URL is not already under base); detect the hub from a variable only the hub sets (NDX_EXTENSION_NAME, or a new NDX_BASE_PATH in the plan) rather than PORT, and update the help text."
acceptanceCriteria:
  - "Run by hand with PORT set and no hub, the face serves its page and modules"
  - "Requests already under the mount are not prefixed again"
  - "serve.test.ts covers both, and ndx graview serve behaves as before"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
