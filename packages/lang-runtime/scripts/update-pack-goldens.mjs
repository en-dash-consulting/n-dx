#!/usr/bin/env node
/**
 * Rewrite a pack's goldens: runs the pack's golden test
 * (`tests/integration/pack-golden.test.ts`) in the current directory with
 * SV_UPDATE_PACK_GOLDENS=1. A pack's `test:update-goldens` script runs it from
 * the pack's root. Review the resulting diff before committing.
 *
 *   pnpm --filter @n-dx/lang-java test:update-goldens
 */

import { startVitest } from "vitest/node";

process.env.SV_UPDATE_PACK_GOLDENS = "1";

const vitest = await startVitest("test", ["tests/integration/pack-golden.test.ts"], {
  root: process.cwd(),
  run: true,
  watch: false,
});
const failed = (vitest?.state.getCountOfFailedTests() ?? 1) > 0;
await vitest?.close();
process.exit(failed ? 1 : 0);
