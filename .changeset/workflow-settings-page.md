---
"@n-dx/web": patch
"@n-dx/core": patch
---

Dashboard: work settings, CLI timeouts and templates are now one Workflow settings page.

The page (`/workflow`, in the settings list where the work settings were)
renders on the shared settings frame: Save writes each changed part to its own
endpoint, and a part whose write fails stays unsaved with its error shown.
Templates still apply immediately; Apply and Save as template are disabled
while the page has unsaved changes, and applying a template refreshes the work
settings. Provider and model are no longer edited here — a link points to
Robot Wrangler, which owns them. Templates are no longer a section of the Work
stage.

`/hench-config`, `/cli-timeouts` and `/hench-templates` redirect to
`/workflow`. The `ndx config` help for `llm.local.timeoutMs` names the new page.
