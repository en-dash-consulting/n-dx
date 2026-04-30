---
id: "3788d2a4-0d5d-410b-81e6-0854bceb1510"
level: "task"
title: "Source subsequent animation frames from nearest reference images and update sequence"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "animation"
  - "ascii-art"
source: "smart-add"
startedAt: "2026-04-09T16:31:08.928Z"
completedAt: "2026-04-09T16:39:16.822Z"
acceptanceCriteria:
  - "Each subsequent animation frame traces back to a specific reference image or a documented interpolation decision from Rex-F.png"
  - "The full animation sequence plays without regressing back to old incorrect frames"
  - "Snapshot tests cover all animation frames and pass"
  - "A comment in the animation source lists the reference image (filename or 'interpolated from Rex-F.png') used for each frame"
description: "Locate reference images in the repository (e.g. packages/rex/) that are most visually similar to Rex-F.png in pose progression, then use them as the basis for each remaining animation frame. For any frame with no close reference image, derive the pose by interpolating logically from Rex-F.png rather than reinventing the character. Update the animation array in code with the corrected frame sequence and update or add snapshot tests covering the full sequence."
log:
  - "[object Object]"
---
