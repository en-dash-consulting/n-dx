---
id: "d7997bfb-31f0-40c7-a69c-c275f7a3f1c3"
type: "change"
title: "Breadcrumb removed; hub, project and branch switchers live in the top bar"
slug: "breadcrumb-removed-hub-project-and"
intent: "User (2026-10-15): \"let's also get rid of this breadcrumb at the top and put the branch/appswitcher (or hubaccess) in the top bar.\" The breadcrumb (components/breadcrumb.ts) shows Hub › project (ProjectSwitcher) + worktree·branch chip (WorkspaceSwitcher) › stage › view and also sets document.title. Remove the breadcrumb row; put the hub link, project switcher and workspace/branch switcher in the top bar's brand area; keep document.title behaviour; keep the help (Guide) control reachable."
acceptanceCriteria:
  - "No breadcrumb row renders above page content."
  - "The top bar shows the project name as the project switcher (with the hub link when a hub answers) and the worktree · branch switcher."
  - "document.title keeps its \"View — Product | Project | n-dx\" form."
  - "The page's help (Guide) control is still reachable."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "ui"
  - "navigation"
source: "ndx-capture"
---
