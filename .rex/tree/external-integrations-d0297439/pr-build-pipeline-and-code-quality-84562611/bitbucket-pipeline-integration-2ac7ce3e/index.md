---
id: "2ac7ce3e-e098-44de-b8ae-07fd2bf64b19"
level: "task"
title: "Bitbucket Pipeline Integration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-24T18:08:30.681Z"
completedAt: "2026-02-24T18:08:30.681Z"
description: "Configure Bitbucket Pipelines to automatically execute PR quality checks\n\n---\n\nReplace the existing Bitbucket Pipelines configuration with an equivalent GitHub Actions workflow that runs build, typecheck, and PRD validation on pull requests and pushes to main."
---

## Subtask: Create bitbucket-pipelines.yml with PR validation workflow

**ID:** `f08cf5a3-2a8e-49c1-874f-5dec139c98ce`
**Status:** completed
**Priority:** high

Migrate the existing bitbucket-pipelines.yml PR validation workflow to a GitHub Actions workflow file at .github/workflows/pr.yml. The workflow should trigger on pull_request events, install pnpm and Node dependencies, run the build pipeline, execute tests, and run rex PRD validation. Remove or archive the Bitbucket Pipelines config to avoid confusion.

**Acceptance Criteria**

- Pipeline triggers automatically on pull requests to main branch
- Pipeline executes the pr-check npm script in proper Node.js environment
- Pipeline caches node_modules and build artifacts for performance
- Pipeline reports clear pass/fail status to Bitbucket with build logs
- .github/workflows/pr.yml exists and triggers on pull_request events targeting main
- Workflow installs correct Node version and pnpm, then runs pnpm install with caching
- Workflow runs pnpm build and fails the PR if the build fails
- Workflow runs pnpm test and fails the PR if tests fail
- Workflow runs the rex PRD validation step (ndx ci or equivalent) and fails on validation errors
- bitbucket-pipelines.yml is removed or contains a deprecation notice pointing to GitHub Actions
- Workflow uses least-privilege permissions (contents: read)

---

## Subtask: Configure pipeline environment and dependency management

**ID:** `8c361512-7a9e-4e47-8910-9c17c4fb7a91`
**Status:** completed
**Priority:** medium

Set up proper Node.js environment, dependency caching, and build artifact handling in Bitbucket Pipelines

**Acceptance Criteria**

- Pipeline uses appropriate Node.js version matching development environment
- Pipeline caches pnpm store and node_modules for faster subsequent builds
- Pipeline handles pnpm installation and workspace setup correctly
- Pipeline includes timeout and resource limit configuration

---

## Subtask: Create GitHub Actions workflow replacing bitbucket-pipelines.yml

**ID:** `b327e7df-acd3-4657-bcb3-d91c5166fa9e`
**Status:** completed
**Priority:** high

Write a .github/workflows/ci.yml that replicates the PR validation pipeline currently defined in bitbucket-pipelines.yml. The workflow should trigger on pull_request and push-to-main events, install pnpm and Node dependencies, run the build, typecheck, and PRD validation steps (pnpm build, pnpm typecheck, node ci.js), and report failures clearly. The existing bitbucket-pipelines.yml should be removed once the GitHub Actions workflow is confirmed working.

**Acceptance Criteria**

- .github/workflows/ci.yml exists and triggers on pull_request (all branches) and push to main
- Workflow installs correct Node version and pnpm, restores node_modules via cache
- pnpm build runs across all packages with no skipped packages
- pnpm typecheck runs across all packages and fails the job on type errors
- node ci.js (or ndx ci .) runs and fails the job when PRD validation fails
- bitbucket-pipelines.yml is removed from the repository
- A passing workflow run is confirmed in GitHub Actions UI

---
