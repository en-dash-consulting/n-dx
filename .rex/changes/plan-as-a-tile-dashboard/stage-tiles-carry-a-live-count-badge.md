---
id: "51c74eb2-9099-4115-950a-a33f32755dee"
type: "task"
title: "Stage tiles carry a live count badge"
slug: "stage-tiles-carry-a-live-count-badge"
description: "#894 gave StageSection a `badge` (read from project status, since a collapsed section never mounts its view). Give StageTile the same optional `badge`, rendered in the tile header from useProjectStatus, and reuse the section badge's styling and tests (stage-section-badge.test.ts)."
acceptanceCriteria:
  - "A StageTile with badge \"inbox\" shows the open Inbox count in its header and updates when the PRD changes"
  - "A tile with no badge renders as before"
  - "A unit test covers the tile badge alongside the section badge test"
priority: "high"
source: "ndx-capture"
---
