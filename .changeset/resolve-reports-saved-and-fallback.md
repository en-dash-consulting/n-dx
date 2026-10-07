---
"@n-dx/hench": patch
"@n-dx/web": patch
---

`ndx work --resolve` reports the task's saved block and each saved setting's fallback.

Three additions to the JSON report, for the dashboard's Prepare task modal:

- **`saved`** — the task's `run` block as rex validated it, or `null` when it carries none. A block that fails validation is also `null`, with a `saved-settings-ignored` warning saying so; it is never a refusal.
- **`fallback`** — on every setting a saved value won, `{value, source}`: what the setting would resolve to without the saved block. Computed by calling the same resolver with the task left out, so the "project default" shown beside a saved value is the one a run would really fall back to.
- **`warnings`** — now also carries the saved-setting notes (`saved-model-incompatible`, `saved-provider-unavailable`, `saved-provider-overridden`, `saved-review-unsupported`, `saved-permission-mode-dropped`) instead of writing them only to stderr. A run started from a browser has no stderr anyone reads, and "your saved model cannot run on this vendor" is exactly what the reader needs before clicking Execute.

The printed `command` is unchanged and now pinned by a test: it is built from flags alone, so a task's saved settings never appear in it. Copying the command and running it applies them again by themselves, where writing them in would freeze them against a block that can change. A flag that happens to equal a saved value is still printed — it was typed.

Web gains the types only, no UI: `PrepResponse.saved`, `PrepResolved.fallback`, and `saved` in the prep test fixture.
