---
id: "ede1af70-6110-418a-b91d-536149a008b4"
type: "change"
title: "Plan and Work follow the planning meeting and the Plan page design"
slug: "plan-and-work-follow-the-planning"
summary: "Plan opens on what you're working on, what matters most and what's next, then how work moves and the product areas; adding work, analysis findings and the Inbox open as side panels. Work splits Ready to run into your tasks and the unassigned ones by product area, gathers the PRD's numbers into one Statistics section, moves the audit to Tune and Workspaces into Settings."
intent: "From the Plan/Work planning meeting notes and the 'n-dx Plan Page Design' artifact (boards: Plan page, Add to the plan side panel). Sections follow the design's content while keeping the dashboard's current styling and colours. Plan keeps its Create/Preparation toggle; the parts of Create the design does not place stay available as transitional side panels rather than being removed. Implemented on branch feat/plan-work-side-panels."
acceptanceCriteria:
  - "Plan › Create shows three glance cards (you're working on, highest priority, what's next for the product), then How work moves, then Product areas with each area's open changes; the Create/Preparation toggle stays."
  - "New change, From analysis and Inbox are right-edge side panels; 'Add to the plan' opens New change; Esc, close and the scrim close a panel and return focus."
  - "Create tiles the design has no place for (Open changes, Plan health, Specs to tighten) are kept as side panels after a divider, not removed."
  - "Work's Ready to run lists your tasks, then the unassigned grouped by product area (top-level section on v1), counting those assigned to others."
  - "Work › Now has one Statistics section: totals, progress, status breakdown, priority distribution and structure health, with no change progress."
  - "The Audit is a tile on Work › Tune."
  - "Workspaces is a Settings page behind an expandable dropdown; /workspaces still opens it."
  - "Styling and colours use the existing dashboard tokens."
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
source: "ndx-capture"
---
