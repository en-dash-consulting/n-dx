---
id: "9dbecc75-f550-4b7b-b3b7-fc2bb3ffef53"
level: "feature"
title: "macOS Local Docker Test Suite"
status: "completed"
source: "smart-add"
startedAt: "2026-04-20T19:16:21.371Z"
completedAt: "2026-04-20T19:16:21.371Z"
acceptanceCriteria: []
description: "Extend the existing Windows Docker gauntlet to include a macOS-representative Linux container that validates base ndx commands on a Unix environment. The Windows Dockerfile targets Windows Server Core; this parallel track creates a Linux-based image (matching macOS runtime behavior) with the same base-command smoke tests, a docker-compose service, and a runner script."
---

## Children

| Title | Status |
|-------|--------|
| [Build Linux/macOS-representative Docker container with ndx base command tests](./build-linux-macos-c17d87/index.md) | completed |
