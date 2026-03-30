#!/usr/bin/env bash
set -euo pipefail
pnpm exec changeset version
node scripts/sync-root-version.js
