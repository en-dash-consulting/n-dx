---
id: "8a78dbcc-ac02-4f0d-8848-9e3641575d03"
type: "change"
title: "Page content paints over the settings overlay instead of under it"
slug: "page-content-paints-over-the-settings"
intent: "Reported against the PRD settings menu opened from the work page: text and controls from the page underneath show through on top of the modal. The cause is global, not specific to that menu.\n\nMechanism:\n- The page below stays fully mounted. `packages/web/src/viewer/main.ts:287` renders `renderViewContent(pageView, …)` unconditionally; the settings overlay is a sibling at `:306-310`, not a replacement. Every work-page node stays live.\n- `.settings-overlay` is `z-index: 60` (`packages/web/src/viewer/styles/shell.css:373-380`). It is an opaque full-bleed panel with no backdrop element.\n- Roughly ten `position: fixed` global trays and toasts render as siblings *after* it at far higher z-indexes, so they paint on top. Among them, several belong to work-page sections: `.audit-toast` z-100 (`styles/task-audit.css:610`), `.wf-toast` z-1000 and `.wf-preview-overlay` z-900 (`styles/workflow-optimization.css:332`, `:279`), `.reorg-overlay` z-10000 (`styles/rex-dashboard.css:733`). The always-on trays sit at 996-998, including `.git-status-banner` z-997 (`styles/git-status.css:12`), `.active-operations-tray`, `.refresh-queue-status`, `.polling-suspension-indicator`, `.sessions-panel`.\n- The trays are suppressed only in deployed/static mode (`styles/deployed.css:81-89`).\n\nWhy it is structural: there are six independent modal implementations with no shared primitive (`settings-overlay.ts`, `settings-frame.ts` leave-guard, `prepare-task-modal.ts`, `prd-tree/delete-confirmation.ts`, `zone-slideout.ts`, `search-overlay.ts`), `createPortal` has zero usages anywhere in `packages/web/src`, and `styles/tokens.css` defines no `--z-*` scale. Stacking is decided ad hoc per component.\n\nTwo related defects worth confirming while in here, but not the headline: `.leave-guard-backdrop` and `.prep-backdrop` are both z-80, and the leave-guard renders inside the z-60 overlay so its 80 only orders it against that overlay's own children. `views/live-bar-model.ts:114` detects \"a modal is open\" by sniffing `[aria-modal=\"true\"]`, which any of the six can trip.\n\nFix shape is deliberately left open. Candidates: introduce `--z-*` tokens plus one shared Modal/Overlay primitive; suppress or relocate the global trays while `settingsOpen`, reusing the deployed-mode pattern; or raise the overlay above 1001 and move the trays into a dedicated layer beneath it."
acceptanceCriteria:
  - "With the settings overlay open over the work page, no content from the page beneath is visible on top of it"
  - "The always-on trays (git status, active operations, refresh queue, polling suspension, sessions panel) do not paint over an open settings overlay"
  - "Work-page toasts that fire while settings are open (`.audit-toast`, `.wf-toast`) do not paint over it either"
  - "Opening a modal from within the settings overlay (the unsaved-changes leave guard) still renders above the overlay's own content"
  - "The stacking order is expressed in one reviewable place rather than as per-component z-index literals"
  - "A regression test or visual check covers the work-page-plus-settings combination that was reported"
touches:
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "css"
  - "z-index"
  - "modal"
source: "ndx-capture"
---
