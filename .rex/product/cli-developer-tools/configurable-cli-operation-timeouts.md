---
id: "888de653-60ad-43bf-843c-a859341d22a3"
type: "capability"
title: "Configurable CLI Operation Timeouts"
slug: "configurable-cli-operation-timeouts"
statement: "The n-dx CLI applies a long default timeout to each command, with per-command overrides, and lets users read and change these timeouts through `ndx config` and the web dashboard settings."
criteria: [{"id":"c1","text":"When a user runs `ndx config set cli.timeoutMs <value>`, the ndx config command shall save the value to .n-dx.json, and the CLI shall use it from the next command run."},{"id":"c2","text":"When a user runs `ndx config get cli.timeoutMs`, the ndx config command shall print the current value, and shall note the default if the key is unset."},{"id":"c3","text":"If a timeout value is not a number or is negative, the config schema validation shall reject it with an error that explains why."},{"id":"c4","text":"When a user runs `ndx config --help`, the ndx config command shall list every timeout key with its default and a description."},{"id":"c5","text":"The web settings UI shall show a 'CLI Timeouts' section with the global timeout and any active per-command overrides."},{"id":"c6","text":"When a user edits and saves a timeout value in the web settings UI, the settings UI shall call the config API to save the value to .n-dx.json."},{"id":"c7","text":"When a user clicks a timeout field's reset button, the web settings UI shall set that field back to its default value."},{"id":"c8","text":"If a user enters a timeout value that is not a number or is negative, the web settings UI shall show an inline error and shall not submit the value."},{"id":"c9","text":"When the settings page loads, the web settings UI shall show the current config values, including changes made outside the dashboard, and not cached ones."}]
source: "smart-add"
---

Introduce a per-command timeout system with a long, safe default so a single stalled process cannot hang the CLI indefinitely. Expose the timeout threshold as a first-class config key editable from both the CLI config command and the web settings UI.
