---
id: "f8d28f62-5d6f-42a4-9ec5-37fa3e4f4057"
level: "task"
title: "Show memory pressure and available memory on the Live tab tile, and never flag an unknown reading"
status: "in_progress"
priority: "high"
tags:
  - "0.8.0"
  - "macos-memory"
blockedBy:
  - "bd14ec22-f146-4315-bd90-e5d5c99d3284"
  - "7c5b3e53-be91-4368-a191-f97ef5ee7bda"
source: "GitHub issue en-dash-consulting/n-dx#497; Live tab memory tile (2026-10-02)"
startedAt: "2026-10-02T03:53:15.953Z"
acceptanceCriteria:
  - "/api/live with an injected darwin reading (os.freemem() 144 MB, availableBytes 3.9 GB of 16 GB, pressure normal) and a 2 GB floor returns machine.memory.availableBytes ≈ 3.9 GB, pressure \"normal\" and belowFloor false (today belowFloor is true)."
  - "An unknown reading returns availableBytes null, pressure \"unknown\" and belowFloor false — including when freeBytes is null (regression test for null <= floor)."
  - "The Live memory tile is labelled \"Memory\", shows the pressure level as its value and \"<available> available · floor <floor>\" as detail; for the 3.9 GB / 2 GB case it is not outlined."
  - "The tile is outlined for pressure warn or critical, or for a known available value at or below the floor, and is never outlined for an unknown reading (which shows \"Unknown\" and \"—\")."
  - "On linux and win32 the tile's warn state matches today's behaviour for the same os.freemem() values against the floor."
  - "No user-facing Live tab text says \"Free memory\"."
  - "A changeset bumps @n-dx/web (patch)."
description: "Depends on the shared reading being wired into readSystemMemory() (previous task) and on PR en-dash-consulting/n-dx#496 having merged into this branch. On a 16 GB Mac the Live tab's memory tile read \"Free memory 144 MB\" with an orange outline against the 2.0 GB hub floor while ~3.9 GB was reclaimable.\n\npackages/web/src/server/routes-live.ts: machine.memory keeps freeBytes, totalBytes, usedPercent, health, floorBytes and belowFloor and adds availableBytes, pressure (\"normal\" | \"warn\" | \"critical\" | \"unknown\") and source. belowFloor = floorBytes !== null && availableBytes !== null && availableBytes <= floorBytes — an explicit null check, because null <= floor is true in JavaScript. packages/web/src/viewer/hooks/use-live.ts: widen the memory type (freeBytes and availableBytes number | null, pressure).\n\npackages/web/src/viewer/views/live-model.ts memory tile: label \"Memory\"; value is the pressure level (Normal / Warn / Critical / Unknown); detail is \"<available> available · floor <floor>\" (omit parts that are null; \"—\" for unknown bytes); warn when pressure is warn or critical, or belowFloor is true; never warn when the reading is unknown. Update any Live view test fixtures, help text or docs that say \"Free memory\". Add a changeset: @n-dx/web patch (fold into the web changeset from the previous task if it is unreleased)."
lastModified: "2026-10-02T03:53:16.341Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
