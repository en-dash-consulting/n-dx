---
id: "fa0a2b37-5288-42aa-8b20-1b2ad6beb0fb"
level: "task"
title: "Remove existing MCP server before re-adding in registerMcpServers"
status: "completed"
priority: "high"
startedAt: "2026-04-09T20:14:34.193Z"
completedAt: "2026-04-09T20:37:10.425Z"
resolutionType: "code-change"
resolutionDetail: "Upgraded registerMcpServers to remove MCP servers from all three scopes (local, project, user) before re-adding, making ndx init fully idempotent."
acceptanceCriteria: []
---
