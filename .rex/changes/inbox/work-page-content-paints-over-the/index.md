---
id: "840160b0-0f30-4d66-bb9e-344fb430853d"
type: "change"
title: "Work page content paints over the prepare-task modal"
slug: "work-page-content-paints-over-the"
intent: "On the Work page, starting a new task opens the prepare-task modal (permission mode, full test gate, session, max turns, token budget). The page underneath shows on top of it: the epic progress rows with their bars and \"100%\"/\"6/6\" counts, and the Quick Actions panel (Browse Tasks, Validate PRD, Reorganize, Restore Snapshot).\n\n`.prep-backdrop` (`packages/web/src/viewer/styles/prepare-task.css`) already sits at `--z-modal` (1001), the top of the z-index scale added by the completed task 8a78dbcc (settings overlay), so the z-index value is not the problem. The modal is mounted in place by `components/start-task-button.ts:335` and `views/view-registry.ts:173` rather than at the document root, which suggests a parent element is creating its own stacking layer (transform, opacity, contain, filter, or a positioned z-index) and holding the modal inside it."
acceptanceCriteria:
  - "With the prepare-task modal open on the Work page, nothing from the page beneath (epic progress rows and bars, percentage and count labels, Quick Actions panel) draws over the modal or its backdrop"
  - "The modal stacks correctly from both places that open it (the start-task button and the view registry)"
  - "The fix names the element that creates the trapping stacking layer, and either removes that layer or renders the modal outside it, rather than raising z-index values"
  - "Other in-page dialogs that use --z-modal or --z-page-modal are checked for the same trap, and any found are fixed or captured"
  - "A regression test or visual check covers the prepare-task modal opened on the Work page"
priority: "high"
tags:
  - "web"
  - "ui"
  - "css"
  - "z-index"
  - "modal"
source: "ndx-capture"
---
