---
id: "e47412ba-b724-4b1c-9cce-707a1b6f36eb"
level: "task"
title: "Claude API Configuration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-06T13:20:43.792Z"
completedAt: "2026-02-06T13:20:43.792Z"
acceptanceCriteria: []
description: "Allow users to configure Claude Code CLI or Anthropic API Key settings that apply across all three packages (sourcevision, rex, hench)"
---

## Subtask: Add Claude API configuration options to unified config

**ID:** `0efd16aa-4cc9-4d5a-a7b6-22d614e9666b`
**Status:** completed
**Priority:** high

Extend the existing unified config command to support Claude Code CLI path and Anthropic API key settings

**Acceptance Criteria**

- ndx config claude.cli_path sets Claude Code CLI path for all packages
- ndx config claude.api_key sets Anthropic API key for all packages
- ndx config --json shows Claude configuration options
- Configuration is stored in project-level config file

---

## Subtask: Implement Claude configuration inheritance in packages

**ID:** `941e9fa4-9be4-4a2f-9a9b-7c01d8e20075`
**Status:** completed
**Priority:** high

Update sourcevision, rex, and hench packages to read Claude configuration from unified config when not set locally

**Acceptance Criteria**

- All packages check unified config for Claude settings
- Local package config overrides unified config
- Packages fall back to environment variables if no config found
- Clear error messages when Claude configuration is missing

---

## Subtask: Add Claude configuration validation

**ID:** `bef0e5e7-d646-406d-a011-b52c7d987c53`
**Status:** completed
**Priority:** medium

Validate Claude Code CLI path exists and API key format is correct when setting configuration

**Acceptance Criteria**

- CLI path validation checks file exists and is executable
- API key validation checks format matches expected pattern
- Helpful error messages for invalid configuration
- Test connection option to verify API key works

---
