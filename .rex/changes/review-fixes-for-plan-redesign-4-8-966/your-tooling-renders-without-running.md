---
id: "47220535-f736-4de6-863f-f13016f3c34e"
type: "task"
title: "Your tooling renders without running the vendor CLI"
slug: "your-tooling-renders-without-running"
description: "Stack review finding on #966 at packages/web/src/viewer/views/tooling-panel.ts:95 (review comment 4488637692).\n\n**Should fix: opening Tune runs a real LLM prompt and holds the tile on Loading…**\n\nThe panel waits for `readAuth` before it renders anything. On a cache miss, `POST /api/commands/auth` spawns `ndx auth`, and that runs the vendor CLI with a real prompt (`config.js:1846`: `-p \"Reply with exactly: ok\"` for claude, `exec … \"Reply with exactly: ok\"` for codex), with a 15 s exec budget. The cache is empty on the first Tune visit after a server start and again after every LLM config save. So the Tune landing spends vendor quota, and a tile that is meant to be read-only shows nothing for several seconds.\n\nFix: render from config and catalog straight away, then fill in the auth line when it resolves. Better still, read only a cached result and leave the live check to Robot Wrangler's Re-check."
acceptanceCriteria:
  - "The Your tooling tile renders from config and catalog at once, without waiting on an auth check"
  - "Opening Tune spawns no ndx auth or vendor CLI: the auth line reads only a cached result, and the live check stays on Robot Wrangler's Re-check"
  - "A test asserts the tile renders without triggering the live auth check"
---
