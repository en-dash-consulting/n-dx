---
id: "9dbecc75-f550-4b7b-b3b7-fc2bb3ffef53"
type: "capability"
title: "macOS Local Docker Test Suite"
slug: "macos-local-docker-test-suite"
statement: "The macOS local Docker test suite runs the base ndx commands in a macOS-representative Linux container, built from Dockerfile.macos and run as the ndx-macos docker-compose service."
criteria: [{"id":"c1","text":"The Dockerfile.macos image build shall produce a working image."},{"id":"c2","text":"When the container runs, the container shall run ndx init, ndx analyze, ndx status and ndx config without errors."},{"id":"c3","text":"docker-compose.yml shall define an ndx-macos service that builds from Dockerfile.macos."},{"id":"c4","text":"When every base command succeeds, the container shall exit with code 0."},{"id":"c5","text":"If any base command fails, the container shall exit with a non-zero code."}]
source: "smart-add"
---

Extend the existing Windows Docker gauntlet to include a macOS-representative Linux container that validates base ndx commands on a Unix environment. The Windows Dockerfile targets Windows Server Core; this parallel track creates a Linux-based image (matching macOS runtime behavior) with the same base-command smoke tests, a docker-compose service, and a runner script.
