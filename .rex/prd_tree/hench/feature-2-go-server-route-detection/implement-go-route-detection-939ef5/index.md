---
id: "939ef567-fbd3-423f-94c7-a51b95fdcf68"
level: "task"
title: "Implement Go route detection analyzer and integrate into the server-route pipeline"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "go"
  - "routes"
source: "smart-add"
startedAt: "2026-03-26T06:35:53.041Z"
completedAt: "2026-03-26T06:43:07.594Z"
acceptanceCriteria:
  - "net/http stdlib patterns (`http.HandleFunc`, `http.Handle`, `mux.HandleFunc`) are detected with correct method and path"
  - "chi method patterns (Get, Post, Put, Delete, Patch) are detected"
  - "gin uppercase method patterns (GET, POST, PUT, DELETE, PATCH) are detected"
  - "echo patterns are detected"
  - "fiber patterns are detected"
  - "gorilla/mux HandleFunc().Methods() chain pattern is detected"
  - "Route path parameters are preserved as-is (e.g., \"/users/{id}\", \"/users/:id\")"
  - "Comments and string literals in non-route code do not produce false positives"
  - "Output conforms to the existing ServerRouteGroup schema"
  - ".go files are dispatched to detectGoServerRoutes instead of the JS/TS route detector"
  - "JS/TS files continue to use the existing Express/Hono/Koa detection with no regression"
  - "The PARSEABLE extension set includes \".go\""
  - "Go route results are merged into the components.json serverRoutes array"
  - "components.json summary.totalServerRoutes includes Go routes in the count"
description: "Create `packages/sourcevision/src/analyzers/go-route-detection.ts` with a `detectGoServerRoutes(sourceText: string, filePath: string): ServerRouteGroup[]` function covering all six framework patterns. Then modify `packages/sourcevision/src/analyzers/server-route-detection.ts` to dispatch to the Go detector for `.go` files, add `.go` to the PARSEABLE extension set, and merge Go routes into `components.json`. The implementation and integration are delivered together because the integration dispatch hook has no value without the implementation."
---

# Implement Go route detection analyzer and integrate into the server-route pipeline

🟠 [completed]

## Summary

Create `packages/sourcevision/src/analyzers/go-route-detection.ts` with a `detectGoServerRoutes(sourceText: string, filePath: string): ServerRouteGroup[]` function covering all six framework patterns. Then modify `packages/sourcevision/src/analyzers/server-route-detection.ts` to dispatch to the Go detector for `.go` files, add `.go` to the PARSEABLE extension set, and merge Go routes into `components.json`. The implementation and integration are delivered together because the integration dispatch hook has no value without the implementation.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** sourcevision, go, routes
- **Level:** task
- **Started:** 2026-03-26T06:35:53.041Z
- **Completed:** 2026-03-26T06:43:07.594Z
- **Duration:** 7m
