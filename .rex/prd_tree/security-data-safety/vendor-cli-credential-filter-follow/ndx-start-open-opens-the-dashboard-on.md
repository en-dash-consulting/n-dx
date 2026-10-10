---
id: "4a9a6abb-4ea7-4559-9a6d-3bec68eea1ff"
level: "task"
title: "ndx start --open opens the dashboard on Windows without cmd.exe"
status: "pending"
priority: "high"
source: "ndx-capture"
acceptanceCriteria:
  - "On win32 the dashboard opener spawns no cmd.exe and no shell: the command is rundll32.exe with url.dll,FileProtocolHandler and the URL as its own argument, without windowsVerbatimArguments (test on the exported pure function)"
  - "A hub dashboard URL carrying an ndx_token and percent escapes (for example %20 and a %NAME%-shaped sequence) reaches the opener's argument list byte-for-byte (test)"
  - "darwin still uses open and linux still uses xdg-open with the URL as the only argument (test)"
  - "openBrowser stays best-effort: detached, unref'd, spawn errors swallowed, so a missing opener never fails ndx start --open"
description: "CodeQL js/shell-command-constructed-from-input alerts #45, #46 and #47 are one source-to-sink path: the dashboard URL built by urlWithAuthToken / hubDashboardUrl (packages/core/web.js) reaches openBrowser, which on win32 spawns cmd.exe /d /s /c 'start \"\" \"<url>\"' with windowsVerbatimArguments. Besides the alert, cmd.exe expands %NAME% inside the quotes, and the URL is full of percent escapes (the ndx_token query parameter and the encoded project id), so a sequence that happens to match an environment variable name is substituted before the browser sees the URL. Fix: open the URL without cmd.exe or any shell. Move the platform choice into a small pure exported function in packages/core/web.js (e.g. browserOpenCommand(url, platform) returning the command, its args and any spawn options) that openBrowser calls; on win32 return rundll32.exe with ['url.dll,FileProtocolHandler', url] and no windowsVerbatimArguments; darwin keeps open, other platforms keep xdg-open. Keep openBrowser best-effort (detached, unref, errors swallowed, windowsHide on win32). Tests go in tests/unit/web-hub-mode.test.js, which already covers the URL helpers. The other nine alerts of that rule (win-spawn.js, llm-client exec.ts, sourcevision exec-cli.ts) are the deliberate .cmd-shim route (GH #37/#68/#69) and the run_command shell; they are dismissed on GitHub with a stated reason, not changed here."
lastModified: "2026-10-10T19:03:23.366Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
