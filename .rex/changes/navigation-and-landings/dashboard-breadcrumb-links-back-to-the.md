---
id: "73c82bdd-d412-4305-bf23-7163656c5664"
type: "task"
title: "Dashboard breadcrumb links back to the hub and switches between registered projects"
slug: "dashboard-breadcrumb-links-back-to-the"
description: "Behind the hub there is no easy way back to the hub's project home page or across to another project. The breadcrumb should start with a \"Hub\" link to /hub, and the project name should open a menu of every registered project; picking one opens the same view under /p/<id>/. With one project or no hub, the name stays plain text and no Hub link appears."
acceptanceCriteria:
  - "Behind the hub, the breadcrumb's first segment is a \"Hub\" link to /hub. With no hub (standalone web serve or a static export), it is absent."
  - "With two or more registered projects, the project name opens a menu listing each project with a status dot, the current one marked. Choosing another goes to /p/<id>/<current view>, and the menu reloads the project list when opened."
  - "With one project, the name stays plain text with no menu."
  - "The menu is keyboard operable: Arrow keys, Home/End, Enter/Space to choose, Escape to close."
  - "Unit tests cover the menu, the Hub link's presence and absence, and the URL and current-project helpers."
priority: "high"
tags:
  - "0.8.0"
  - "navigation-landings"
source: "ndx-capture"
blockedBy:
  - "bc0b4de5-ecb7-490f-b2a9-94ca4711b65a"
---
