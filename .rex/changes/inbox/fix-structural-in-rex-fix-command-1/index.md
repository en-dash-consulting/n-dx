---
id: "5d586da2-f978-41f3-b5d5-2d25080f865b"
type: "change"
title: "Fix structural in rex-fix-command (1 finding)"
slug: "fix-structural-in-rex-fix-command-1"
intent: "- src/core/fix.ts is separated from the src/fix/ entry point by an artificial directory boundary, lowering cohesion to 0.33 without reflecting a meaningful architectural split"
priority: "high"
source: "sourcevision"
---
