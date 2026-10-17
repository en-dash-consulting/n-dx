#!/usr/bin/env node
/**
 * Rewrite the build-model goldens: runs their tests with
 * SV_UPDATE_PACK_GOLDENS=1. Review the resulting diff before committing. Each
 * language pack rewrites its own goldens (`pnpm --filter @n-dx/lang-java
 * test:update-goldens`).
 *
 *   pnpm --filter @n-dx/sourcevision test:update-goldens
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.env.SV_UPDATE_PACK_GOLDENS = "1";

const GOLDEN_TESTS = [
  "tests/unit/language/java-maven-build.test.ts", // build-model goldens under tests/fixtures/maven-build
  "tests/unit/language/java-gradle-build.test.ts", // build-model goldens under tests/fixtures/gradle-build
];

const vitest = await startVitest("test", GOLDEN_TESTS, {
  root: PACKAGE_ROOT,
  run: true,
  watch: false,
});
const failed = (vitest?.state.getCountOfFailedTests() ?? 1) > 0;
await vitest?.close();
process.exit(failed ? 1 : 0);
