---
"@n-dx/web": patch
---

Dashboard: analyze and plan settings, feature flags, Notion and integrations are now one Project settings page.

The page (`/project`, in the settings list where analyze and plan settings were)
renders on the shared settings frame: Save writes each changed section to its own
endpoint, and a section whose write fails stays unsaved with its error shown.
Feature flags now save with the rest of the page instead of on each click, and
the dashboard is told about a flag only once it has been saved. Notion and
Integrations appear on the page only while `rex.notionSync` / `rex.integrations`
is on; testing, syncing, disconnecting and removing stay immediate buttons.

`/project-settings`, `/feature-toggles`, `/notion-config` and `/integrations`
redirect to `/project`. The export and refresh panels stay on the Commands
page, which is now labelled "Commands".
