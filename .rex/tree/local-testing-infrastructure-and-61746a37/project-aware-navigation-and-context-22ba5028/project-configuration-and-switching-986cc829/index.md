---
id: "986cc829-245a-4756-a64b-84bb9cf11961"
level: "task"
title: "Project Configuration and Switching"
status: "completed"
source: "smart-add"
startedAt: "2026-02-17T23:53:56.173Z"
completedAt: "2026-02-17T23:53:56.173Z"
acceptanceCriteria: []
description: "Display project-specific configuration and provide interface for switching between projects\n\n---\n\nAutomatically detect project metadata and provide it through a web API endpoint for navigation components\n\n---\n\nLink hench runs to specific PRD tasks for better tracking and audit trails"
---

## Subtask: Implement configuration display and project switching interface

**ID:** `350090b9-2b13-478a-a9ad-e96dc03d07c0`
**Status:** completed
**Priority:** low

Show active n-dx configuration in navigation footer and provide UI for switching between different project directories

**Acceptance Criteria**

- Shows currently configured Claude model
- Displays token budget settings if configured
- Indicates authentication method (API key vs CLI)
- Collapses/expands to save space when needed
- Detects other n-dx projects in parent/sibling directories
- Provides dropdown or modal for project selection
- Maintains session state when switching projects
- Updates all navigation context when project changes

---

## Subtask: Build project metadata extraction and API service

**ID:** `cb82fcad-a548-462e-b634-5f2095745d40`
**Status:** completed
**Priority:** high

Extract project information from package.json and git, then expose it through a cached API endpoint for web UI consumption

**Acceptance Criteria**

- Reads project name from package.json if available
- Falls back to directory name if no package.json
- Extracts git repository name from remote origin URL
- Handles cases where git is not initialized or has no remotes
- Returns JSON with project name, description, git info
- Handles missing or invalid project directories gracefully
- Caches project metadata to avoid repeated file system calls
- Updates context when project directory changes

---

## Subtask: Implement complete task-run association with graceful handling

**ID:** `fc50c6e4-6b64-45fc-923c-ccac4a0aa448`
**Status:** completed
**Priority:** high

Create end-to-end association between hench runs and PRD tasks, including display of task information, metadata storage, and robust handling of task lifecycle changes

**Acceptance Criteria**

- Hench displays task ID and title when starting a run
- Task information is shown before any work begins
- Output format is consistent and easily readable
- Run metadata includes associated task ID
- Task association is stored when run is created
- Metadata persists across run lifecycle
- Runs display 'Task deleted' or similar when task no longer exists
- Historical run records remain accessible
- No crashes or errors when referencing deleted tasks

---
