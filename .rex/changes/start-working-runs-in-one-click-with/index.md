---
id: "2323d387-7513-4edb-b76f-613a3f00919a"
type: "change"
title: "Start Working runs in one click with the task's saved settings, and its arrow opens the settings"
slug: "start-working-runs-in-one-click-with"
intent: "Requested 2026-11-08: the dashboard's Start Working control should run in one click, and its ▾ arrow should open the run settings.\n\n## Today\n\n`packages/web/src/viewer/components/start-task-button.ts` (`StartTaskButton`, mounted through `TaskStartControl` by the Rex Dashboard's Up Next card, the Hench Runs empty state, the Live idle card, each Workspaces card and the PRD task panel) is a split button:\n\n- the primary \"Start Working\" / \"Start Task\" click opens the Prepare task modal (`prepare-task-modal.ts`);\n- the ▾ caret opens a menu whose \"Start now\" item is the one-click run (`POST /api/hench/execute {taskId}`), with the run-mode picker (one / N tasks / loop) riding beside it.\n\nSo the common case, run with the settings already chosen, takes two clicks behind a caret, and the primary button opens a form.\n\n## Wanted\n\n- Primary click: start the run now. If the task has a saved `run` block, the run uses it (the server already applies it). If it has none, the project defaults the Prepare task modal would show are saved on the task as its `run` block, and the run starts with them, so the settings the run used are visible and editable afterwards.\n- ▾ arrow: opens the Prepare task modal (the run settings) directly, with no intermediate menu.\n- The hub home page's \"Start working\" link (`packages/web/src/hub/home.ts`) keeps linking to the project's Runs view; out of scope."
acceptanceCriteria:
  - "Clicking the Start Working / Start Task button starts the run immediately (POST /api/hench/execute) without opening the Prepare task modal"
  - "A task with a saved run block is started with those settings by the one click"
  - "A task with no saved run block has the project defaults saved on it as its run block, and the run starts with them, in the same click"
  - "The ▾ arrow opens the Prepare task modal directly, with no intermediate menu"
  - "The run-mode picker (one task / N tasks / loop) still governs the one-click run where runModes is set, and resets to one task after a start"
  - "A queued reply (202) and the slug-migration 412 still behave as they do today on the one-click path"
  - "Every mount (Up Next card, Hench Runs empty state, Live idle card, Workspaces cards, PRD task panel) gets the new behaviour, and the component's tests cover the primary click, the arrow, and the no-saved-settings case"
touches:
  - "2171d478-2d5b-4926-8e85-837f52c99abd"
priority: "high"
source: "ndx-capture"
---
