---
id: "28ab2232-830a-42b8-a80e-f2f4cf3902e7"
type: "task"
title: "Below 1440 px the top-nav run control hides its status, so a failed or finished run shows only ▶"
slug: "below-1440-px-the-top-nav-run-control"
description: "Verdict: should-fix (medium). Found by the adversarial review of c1540b54.\n\nScenario: at any viewport below 1440 px (a 1280 or 1366 laptop), start a run command from the top-nav run control and let it fail, stop or finish. sidecar.css hides `.topnav-run .runcmd-label` below 1440, and that span is the only place the status text (\"Finished\", \"Stopped\", the error message, the running label) is drawn. The button then shows only ▶ (or the spinner while running). Its `title` names the chosen command, not the status. The status is reachable only through the new aria-label \"Run project: <status>\", so a sighted user cannot tell a failed run from an idle one. The rule is not scoped to the Sidecar, so this also hits users with web.sidecar off, whose bar had room for the label before.\n\nEvidence: packages/web/src/viewer/styles/sidecar.css, the `max-width: 1439px` tier (`.topnav-run .runcmd-label { display: none; }`); packages/web/src/viewer/components/run-command-control.ts, statusText → `.runcmd-label`.\n\nOptions:\n1. Keep the label hidden, but add state modifier classes (`runcmd-btn--error`, `--finished`) that colour the glyph or add a dot, and put statusText into `title`. Cheap and keeps the width win. Recommended.\n2. Hide the label only while idle (\"Found … command\") and show it for error, stopped and running states. Simple, but a long error message can outgrow the tier; it would need a max-width.\n3. Scope the rule to `.topnav:has(.topnav-sidecar)` so Sidecar-off users keep the label. Narrows the reach but does not fix it."
acceptanceCriteria:
  - "At 1280 px, a run control whose last run failed shows a visible error state (colour or marker) distinct from idle, covered by a unit or e2e-ui test"
  - "At 1280 px, hovering the run control shows the current status text (for example its title includes the error)"
  - "With web.sidecar off, the run control's label behaviour at 1200–1439 px is a stated decision in the UX2' tier comment in sidecar.css"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
