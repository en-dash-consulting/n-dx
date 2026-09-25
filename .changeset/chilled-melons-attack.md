---
"@n-dx/core": patch
"@n-dx/hench": patch
---

Check the sourcevision primer's fingerprint before trusting it, and seed hench orientation with it.

`ndx work` preferred `.sourcevision/PRIMER.md` over CONTEXT.md whenever the file existed, with no freshness check — so a primer left behind by an earlier analysis was served to every task as current. It is now used only when the fingerprint it was stamped with matches the current `manifest.json`; a stale, unstamped, or empty primer falls back to CONTEXT.md.

hench's orientation session now starts from that same primer instead of rediscovering the repo layout with an LLM, and asks the session to confirm and correct it rather than explore from zero. A primer that fails the fingerprint check is ignored, so orientation never inherits a stale description.

hench's warm-parent session cache now keys on the same fingerprint as the primer check. Before, hench joined the manifest fields with a NUL byte where sourcevision used a space, so its `sourcevisionFingerprint` and sourcevision's `primerFingerprint` could never agree; `tests/integration/primer-fingerprint-contract.test.js` now holds the implementations in agreement. Existing `.hench/session-cache.json` entries re-orient after upgrading, and once more after the first analysis that stamps the primer's content fingerprint.
