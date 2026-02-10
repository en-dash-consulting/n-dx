import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Map local .js imports to .ts files (only relative paths)
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    include: [
      "tests/**/*.test.ts",
    ],
  },
});
