---
id: "66f9d899-eb90-448d-860f-02ba401b4de1"
level: "task"
title: "Direct Claude API Integration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-08T15:36:41.049Z"
completedAt: "2026-02-08T15:36:41.049Z"
acceptanceCriteria: []
description: "Allow rex, hench, and sourcevision to authenticate with Claude API using API keys instead of requiring Claude Code CLI"
---

## Subtask: Add API key configuration options to unified config

**ID:** `f0d8a0de-4f9b-4d01-b83f-31178cc8384f`
**Status:** completed
**Priority:** high

Extend the unified configuration system to support Claude API key settings with proper validation and secure storage

**Acceptance Criteria**

- API key can be set via ndx config command
- API key is stored securely with appropriate file permissions
- Configuration includes API endpoint and model selection options
- Validates API key format and accessibility

---

## Subtask: Implement API client abstraction layer

**ID:** `789effcc-9c2f-4910-87fb-8d3a4389b1e4`
**Status:** completed
**Priority:** high

Create a shared API client that can switch between Claude Code CLI and direct API calls based on configuration

**Acceptance Criteria**

- Single interface supports both CLI and API authentication methods
- Graceful fallback when CLI is not available
- Consistent error handling across authentication methods
- Maintains feature parity between CLI and API modes

---

## Subtask: Update rex package to support API key authentication

**ID:** `2b0d10dc-a639-4183-9a2f-8e4b244309af`
**Status:** completed
**Priority:** high

Modify rex analyze and other LLM-dependent commands to use the API client abstraction for Claude API calls

**Acceptance Criteria**

- Rex analyze works with direct API authentication
- All LLM interactions respect API key configuration
- Token tracking works correctly with API calls
- Error messages clearly indicate authentication method being used

---

## Subtask: Update hench package to support API key authentication

**ID:** `17ec3fca-6ae4-4534-ac22-b0e692f23c36`
**Status:** completed
**Priority:** high

Modify hench run command and agent loops to use direct API authentication when configured

**Acceptance Criteria**

- Hench runs execute successfully with API key authentication
- Tool use loops work correctly with direct API calls
- Run transcripts properly record API usage
- Agent behavior is consistent between CLI and API modes

---

## Subtask: Update sourcevision package to support API key authentication

**ID:** `2baa9258-8099-4332-a064-e4fd30a5453b`
**Status:** completed
**Priority:** high

Modify sourcevision analyze and LLM-dependent features to use direct API authentication

**Acceptance Criteria**

- Sourcevision analyze generates context with API authentication
- Zone detection and component analysis work with API calls
- Token usage is properly tracked for API requests
- Analysis quality remains consistent across authentication methods

---

## Subtask: Add authentication method detection and validation

**ID:** `b6515a61-9f9c-4cd5-8bd0-4c433d01e405`
**Status:** completed
**Priority:** medium

Implement logic to automatically detect available authentication methods and validate configuration

**Acceptance Criteria**

- Automatically detects if Claude Code CLI is available
- Falls back to API key if CLI is not found
- Validates API key accessibility before attempting requests
- Provides clear error messages for authentication failures

---
