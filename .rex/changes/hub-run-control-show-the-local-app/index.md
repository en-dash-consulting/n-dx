---
id: "18150b27-91be-436d-bd21-d8f2ef018e01"
type: "change"
title: "Hub run control: show the local app link, render colored output, collapse logs to the last 3 lines"
slug: "hub-run-control-show-the-local-app"
intent: "When a command started from the hub's Run control hosts on a local port, the user should get a link they can click to open the app they built. Today the server's `findLocalUrl` (packages/web/src/server/run-command-detect.ts) scans output that still contains ANSI escape codes, so a dev server that colors its URL (Vite bolds the port: `http://localhost:\\x1b[1m5173\\x1b[22m/`) never yields a link. The Output panel in packages/web/src/viewer/components/run-command-control.ts dumps the raw escape sequences (`[0m`, `[2m` …) as text in a plain `<pre>` instead of rendering them as color, and always shows a 2000-character block rather than the last few lines with a way to see the rest."
acceptanceCriteria:
  - "A local URL in a run command's output produces an open-app link even when the dev server colors or bolds parts of it: ANSI codes are stripped before `findLocalUrl` runs, with a test covering Vite-style output whose port is bolded"
  - "The open-app link is a button at the bottom left of the Run/build menu, across from the Stop button; it opens the app in a new tab and is shown while the command runs and a URL has been found"
  - "The Output panel renders ANSI SGR codes as colors and bold/dim styling; no `[0m`-style sequences appear as literal text"
  - "Codes the panel cannot render are dropped, and output text stays escaped so it cannot inject markup"
  - "The Output panel defaults to a collapsed view of the 3 most recent lines, with a control that expands it to the full retained log and collapses it again"
  - "The collapsed view updates its 3 lines as new output arrives; the expanded view stays scrolled to the end of the log"
touches:
  - "1a326041-9ce2-490e-80ae-55fbdaf81543"
priority: "medium"
source: "ndx-capture"
---
