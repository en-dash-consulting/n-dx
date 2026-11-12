---
"@n-dx/web": patch
---

Settings › Project groups its settings by what they change, lists its sections in the settings menu, and adds a search box.

The sections are Analysis, Dashboard, Git and commits, Display, Optional features and Connections. Each setting is now one row showing its label, a one-line description, the `.n-dx.json` key it is stored under, and its control. Cost and impact sit behind an ⓘ button, and Tokens, Restart and Experimental tags stay visible. A dot marks a value you have changed but not saved, and Reset puts the default back for Save to write. Zone pins collapse to a count with an Edit button. The search matches a setting's name, description or config key, and hides sections with no match. The stats bar and the stability legend are gone.

The GitHub reads switch (`web.sidecarGithubReads`) moves from Workflow › Sidecar to Project › Connections. Fail-forward and auto-commit of generated files are now marked stable rather than experimental. They are still off by default, and stored values keep working.
