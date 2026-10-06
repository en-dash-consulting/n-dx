---
"@n-dx/web": patch
"@n-dx/hench": patch
---

Tests only: the Prepare task workspace-header test covers prep, preview, execute and migrate; run-option checks are pinned for control characters, prototype keys, string-typed numbers and integer bounds; the run-options contract test reads source and checks bounds against `ndx work --resolve`; the resolve no-side-effect test seeds a session cache; a real-server test sends `/w/<key>/` and `X-Ndx-Workspace` to the ready and prep routes.
