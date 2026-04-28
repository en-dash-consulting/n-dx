---
id: "8a65d7cd-40ea-4f87-bf10-23396c378a35"
level: "task"
title: "Web server and API integration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-06T05:52:08.769Z"
completedAt: "2026-02-06T05:52:08.769Z"
description: "Implement backend server to serve the web interface and provide API endpoints for Rex and sourcevision data"
---

## Subtask: Create web server with API endpoints

**ID:** `7bce80df-5df2-4dc9-88d3-947c72b4dbd0`
**Status:** completed
**Priority:** high

Build Express/Fastify server that exposes Rex and sourcevision data through REST API and serves the web interface

**Acceptance Criteria**

- Server serves static web assets
- API endpoints provide Rex PRD data
- API endpoints provide sourcevision analysis data
- WebSocket support for real-time updates

---

## Subtask: Add web command to n-dx CLI

**ID:** `e68c5d72-833d-4766-908d-da8ab8517622`
**Status:** completed
**Priority:** medium

Extend n-dx orchestration with web server command that starts the unified viewer

**Acceptance Criteria**

- ndx web command starts server on configurable port
- Command supports background/daemon mode
- Proper shutdown handling and port management
- Integration with existing n-dx config system

---
