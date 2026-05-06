---
id: "718406b9-2826-4a8b-a6d7-94f76b846b00"
level: "task"
title: "Implement local gauntlet test runner script"
status: "completed"
priority: "high"
tags:
  - "testing"
  - "docker"
  - "automation"
  - "macos"
  - "shell"
source: "smart-add"
startedAt: "2026-04-15T14:57:43.008Z"
completedAt: "2026-04-20T19:13:21.724Z"
resolutionType: "code-change"
resolutionDetail: "Fixed platform-specific shell command selection in run-gauntlet.sh. The script now correctly uses /bin/bash -c for macOS/Linux containers and powershell -Command for Windows containers, matching each platform's Dockerfile entrypoint configuration."
acceptanceCriteria:
  - "Shell script (e.g., run-gauntlet.sh) in .local_testing/ starts container and runs tests"
  - "Test output is readable and includes progress indicators"
  - "Exit codes reflect gauntlet pass/fail status"
  - "Documentation includes command examples and troubleshooting"
  - "Script handles container cleanup on completion"
  - "Script builds the macOS Docker image and runs the gauntlet test suite inside it"
  - "Script returns exit code 0 on test pass, non-zero on failure or Docker error"
  - "--no-build, --keep-container, and --verbose flags work as documented"
  - "Script can be run from the repo root on a macOS or Linux host"
  - "Container is automatically removed after tests unless --keep-container is set"
description: "Add run-gauntlet-macos.sh (or extend run-gauntlet.sh with a --platform flag) to build and run the macOS container, streaming test output and returning meaningful exit codes. Validate the full flow: build → run → stream output → clean up. Runner should accept --no-build, --keep-container, and --verbose flags matching the existing Windows runner interface."
---

# Implement local gauntlet test runner script

🟠 [completed]

## Summary

Add run-gauntlet-macos.sh (or extend run-gauntlet.sh with a --platform flag) to build and run the macOS container, streaming test output and returning meaningful exit codes. Validate the full flow: build → run → stream output → clean up. Runner should accept --no-build, --keep-container, and --verbose flags matching the existing Windows runner interface.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** testing, docker, automation, macos, shell
- **Level:** task
- **Started:** 2026-04-15T14:57:43.008Z
- **Completed:** 2026-04-20T19:13:21.724Z
- **Duration:** 5d 4h 15m
