#!/usr/bin/env node
/**
 * Rewrite the language-pack goldens: runs the golden harness with
 * SV_UPDATE_PACK_GOLDENS=1. Review the resulting diff before committing.
 *
 *   pnpm --filter @n-dx/sourcevision test:update-goldens
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.env.SV_UPDATE_PACK_GOLDENS = "1";

const vitest = await startVitest("test", ["tests/integration/language-pack-goldens.test.ts"], {
  root: PACKAGE_ROOT,
  run: true,
  watch: false,
});
const failed = (vitest?.state.getCountOfFailedTests() ?? 1) > 0;
await vitest?.close();
process.exit(failed ? 1 : 0);
