import { defineConfig } from "vitest/config";

// The tests are headless and need none of vite.config.ts (the door, the chunking), which stays importable without vitest.
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
