import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Map local .js imports to .ts files
      { find: /^(\..+)\.js$/, replacement: "$1.ts" },
    ],
  },
  test: {
    // Shared: pin color detection so an ambient FORCE_COLOR in the developer's
    // shell cannot change test verdicts. See tests/setup-color-env.js.
    setupFiles: ["../../tests/setup-color-env.js", "../../tests/setup-session-env.js"],
    include: ["tests/**/*.test.ts"],
  },
});
