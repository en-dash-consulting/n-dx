import { defineConfig } from "vitest/config";
import { hiddenChildProcessAlias } from "../../tests/hidden-child-process-alias.mjs";

// The tests are headless and need none of vite.config.ts (the door, the chunking), which stays importable without vitest.
export default defineConfig({
  resolve: { alias: [...hiddenChildProcessAlias] },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
