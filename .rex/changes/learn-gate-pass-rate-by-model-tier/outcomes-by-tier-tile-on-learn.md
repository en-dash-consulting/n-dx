---
id: "473f2c52-e332-473f-9459-ccf1c16b7998"
type: "task"
title: "Outcomes by tier tile on Learn"
slug: "outcomes-by-tier-tile-on-learn"
description: "Read hench run records for the last 30 days, group by vendor and tier (resolved model kept for the tooltip), and compute gate pass rate and run count; records without a gate result are counted separately and left out of the rate. Render as a 4×2 Learn tile with one bar per tier. Read the records through the existing hench gateway used by the Runs view; no new data is written."
acceptanceCriteria:
  - "Pass rate and run count per vendor and tier match a hand count on fixture run records"
  - "Records without a gate result are excluded from the rate and counted"
  - "The tile states it covers runs on this machine and shows the window"
priority: "low"
source: "ndx-capture"
---
